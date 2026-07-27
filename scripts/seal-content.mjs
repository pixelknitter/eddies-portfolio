#!/usr/bin/env node
/**
 * Seal content that should not be readable in a public repo.
 *
 * The scheduling feature works at request time: a post with a future
 * `publishDate` 404s until it is due. That protects the *site*. It does
 * nothing for the repo, where the markdown sits in plain view on GitHub the
 * moment it is committed — so anything scheduled is readable by anyone who
 * looks, days before it is meant to exist.
 *
 * Sealing closes that gap. A sealed file is committed as an encrypted blob;
 * CI decrypts it during the build with a key that never leaves the secret
 * store. The published site is unchanged, and the runtime `publishDate` gate
 * still decides when a post appears.
 *
 * It walks the whole content root, so one key covers every collection — blog
 * posts, STAR stories, projects, authors. Scheduled posts are the obvious
 * case; STAR stories are the quieter one, since a career story can carry a
 * client name or a revenue figure that belongs in A.I.R.'s answers but not in
 * a public repository. A sealed story is unsealed at build time and feeds
 * A.I.R. exactly as an unsealed one does.
 *
 * ## What this does and does not protect
 *
 * It protects the **repository**. It does not hide a decrypted post from the
 * deployed Worker's server bundle — but that bundle is not publicly
 * downloadable, and the `publishDate` gate governs what is served. The threat
 * this addresses is a reader browsing GitHub, which is the actual exposure.
 *
 * A key rotation re-seals everything; the old blobs stay in git history, so
 * treat a leaked key as "every post ever sealed with it is public" and rotate
 * by re-sealing with a new key rather than assuming history is clean.
 *
 * ## Key handling
 *
 * `CONTENT_SEAL_KEY` is a **passphrase**, not raw key material. It is stretched
 * with scrypt against a per-file random salt, so a memorable phrase is as safe
 * to use as a base64 blob — and losing the key is the failure mode most likely
 * to actually happen to a solo maintainer. The salt lives in the sealed file,
 * which is what lets every file derive independently.
 *
 * Sealed files are self-describing JSON (`v`, `algo`, `kdf`, `salt`, `iv`,
 * `tag`, `data`) so a future format change can be detected rather than
 * mis-decrypted.
 *
 * Usage:
 *   CONTENT_SEAL_KEY=... node scripts/seal-content.mjs keygen
 *   CONTENT_SEAL_KEY=... node scripts/seal-content.mjs seal   src/content/blog/post.md
 *   CONTENT_SEAL_KEY=... node scripts/seal-content.mjs unseal-all
 *   node scripts/seal-content.mjs check
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

const CONTENT_ROOT = 'packages/web-astro/src/content';
const SEALED_SUFFIX = '.sealed';
const GITIGNORE_START = '# BEGIN sealed-content (managed by scripts/seal-content.mjs)';
const GITIGNORE_END = '# END sealed-content';

const args = process.argv.slice(2);
const [command, target] = args.filter((arg) => !arg.startsWith('--'));
const requireKey = args.includes('--require-key');

function hasKey() {
  return Boolean(process.env.CONTENT_SEAL_KEY);
}

const FORMAT_VERSION = 1;
/** scrypt cost. 2^15 keeps a wrong-guess expensive without stalling a build. */
const SCRYPT_N = 32768;

function passphrase() {
  const raw = process.env.CONTENT_SEAL_KEY;
  if (!raw || raw.trim() === '') {
    console.error('✖ CONTENT_SEAL_KEY is not set.');
    console.error('  Generate a suggestion with: node scripts/seal-content.mjs keygen');
    console.error('  Any passphrase works — it is stretched with scrypt, not used directly.');
    process.exit(1);
  }
  return raw;
}

/** @param {Buffer} salt */
function deriveKey(salt) {
  return scryptSync(passphrase(), salt, 32, { N: SCRYPT_N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

/**
 * AES-256-GCM. Authenticated on purpose: without the tag, a tampered blob
 * would decrypt to garbage and be published as a post.
 */
function seal(plaintext) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(salt), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return `${JSON.stringify(
    {
      v: FORMAT_VERSION,
      algo: 'aes-256-gcm',
      kdf: 'scrypt',
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      data: data.toString('base64'),
    },
    null,
    2
  )}\n`;
}

function unseal(blob) {
  let envelope;
  try {
    envelope = JSON.parse(blob);
  } catch {
    throw new Error('malformed sealed file — expected JSON');
  }

  // Refuse a format we do not understand rather than mis-decrypting it into
  // something that looks like a post.
  if (envelope.v !== FORMAT_VERSION) {
    throw new Error(`unsupported sealed format v${envelope.v}; this build understands v${FORMAT_VERSION}`);
  }
  if (envelope.algo !== 'aes-256-gcm' || envelope.kdf !== 'scrypt') {
    throw new Error(`unsupported algo/kdf: ${envelope.algo}/${envelope.kdf}`);
  }

  const key = deriveKey(Buffer.from(envelope.salt, 'hex'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
  const body = envelope.data;

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // GCM's auth tag failing means the wrong key or a tampered blob. Say
    // which, rather than surfacing a raw crypto stack trace.
    throw new Error(
      'could not decrypt — CONTENT_SEAL_KEY is wrong, or the sealed file has been altered'
    );
  }
}

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

const sealedFiles = () => [...walk(CONTENT_ROOT)].filter((file) => file.endsWith(SEALED_SUFFIX));
const plaintextOf = (sealed) => sealed.slice(0, -SEALED_SUFFIX.length);

/**
 * Keep the ignore list explicit rather than clever.
 *
 * There is no glob that means "a .md whose .sealed sibling exists", so the
 * filenames are written into a managed block. Explicit and greppable beats a
 * pattern nobody can verify — and a missed entry here means committing the
 * plaintext of something you deliberately sealed.
 *
 * The block is matched globally and collapsed to one. The first version built
 * its regex from the marker text unescaped — and that text contains `(`, `)`
 * and `.`, so it never matched itself and appended a fresh block on every
 * seal. Twelve of them reached a commit before anyone looked at the diff.
 */

/** @param {string} value */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function syncGitignore() {
  const entries = sealedFiles().map(plaintextOf).sort();
  const block = [
    GITIGNORE_START,
    '# Plaintext of sealed posts. Regenerated at build time; never committed.',
    ...entries.map((entry) => `/${entry}`),
    GITIGNORE_END,
  ].join('\n');

  const path = '.gitignore';
  const current = readFileSync(path, 'utf8');
  const pattern = new RegExp(
    `${escapeRegExp(GITIGNORE_START)}[\\s\\S]*?${escapeRegExp(GITIGNORE_END)}\\n?`,
    'g'
  );

  // Strip every existing block — including duplicates a previous buggy run
  // left behind — then append exactly one.
  const withoutBlocks = current.replace(pattern, '').replace(/\n{3,}/g, '\n\n');

  // Nothing sealed means no block. Leaving an empty one behind is noise in
  // every future diff, and it made the test suite dirty the real .gitignore.
  writeFileSync(
    path,
    entries.length === 0
      ? `${withoutBlocks.trimEnd()}\n`
      : `${withoutBlocks.trimEnd()}\n\n${block}\n`
  );
}

function isTracked(path) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', path], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

try {
  switch (command) {
    case 'keygen': {
      console.log(randomBytes(32).toString('base64'));
      console.log('');
      console.log('A suggestion, not a requirement — CONTENT_SEAL_KEY is a passphrase and is');
      console.log('stretched with scrypt, so anything long and unguessable works. Prefer');
      console.log('something you can retrieve in a year over something you must never lose.');
      console.log('');
      console.log('Store it as a GitHub Actions secret AND in your password manager.');
      console.log('Losing it means losing every sealed file.');
      break;
    }

    case 'seal': {
      if (!target) {
        console.error('✖ Usage: seal <path-to-markdown>');
        process.exit(1);
      }
      const sealedPath = `${target}${SEALED_SUFFIX}`;
      writeFileSync(sealedPath, seal(readFileSync(target, 'utf8')));
      unlinkSync(target);
      syncGitignore();

      console.log(`✓ Sealed ${relative('.', target)} → ${relative('.', sealedPath)}`);
      console.log('  The plaintext has been removed and added to .gitignore.');
      console.log('  Commit the .sealed file and the .gitignore change together.');
      break;
    }

    case 'unseal': {
      if (!target) {
        console.error('✖ Usage: unseal <path-to-sealed>');
        process.exit(1);
      }
      writeFileSync(plaintextOf(target), unseal(readFileSync(target, 'utf8')));
      console.log(`✓ Unsealed ${relative('.', plaintextOf(target))}`);
      break;
    }

    case 'unseal-all': {
      const files = sealedFiles();
      if (files.length === 0) {
        console.log('No sealed content. Nothing to do.');
        break;
      }

      // A pull request from a fork cannot see the secret. Failing there would
      // block contributions over content it has no business reading, so warn
      // and build without the sealed posts — they are unpublished anyway.
      // Deploys pass --require-key, where a missing key must be fatal rather
      // than silently shipping a site with posts missing.
      if (!hasKey()) {
        const message = `${files.length} sealed file(s) present but CONTENT_SEAL_KEY is not set`;
        if (requireKey) {
          console.error(`✖ ${message} — refusing to deploy without them.`);
          process.exit(1);
        }
        console.warn(`⚠ ${message}; building without them.`);
        break;
      }

      for (const file of files) {
        writeFileSync(plaintextOf(file), unseal(readFileSync(file, 'utf8')));
        console.log(`✓ ${relative('.', plaintextOf(file))}`);
      }
      console.log(`Unsealed ${files.length} file(s).`);
      break;
    }

    // The guard that makes the whole thing trustworthy: sealing is pointless if
    // the plaintext is committed alongside the blob. Runs in CI.
    case 'check': {
      const leaked = sealedFiles()
        .map(plaintextOf)
        .filter((path) => isTracked(path));

      if (leaked.length > 0) {
        console.error('✖ Sealed posts whose plaintext is also committed:');
        for (const path of leaked) console.error(`  ${path}`);
        console.error('');
        console.error('  Sealing does nothing while the plaintext is in the repo. Remove it:');
        console.error('    git rm --cached <path> && node scripts/seal-content.mjs seal <path>');
        process.exit(1);
      }

      console.log(`✓ ${sealedFiles().length} sealed file(s); no plaintext committed.`);
      break;
    }

    default:
      console.error('Usage: seal-content.mjs <keygen|seal|unseal|unseal-all|check> [path]');
        console.error('       unseal-all [--require-key]   fail rather than skip when the key is absent');
        process.exit(1);
    }
} catch (error) {
  console.error(`✖ ${error.message}`);
  process.exit(1);
}
