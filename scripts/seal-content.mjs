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
 * Usage:
 *   CONTENT_SEAL_KEY=... node scripts/seal-content.mjs keygen
 *   CONTENT_SEAL_KEY=... node scripts/seal-content.mjs seal   src/content/blog/post.md
 *   CONTENT_SEAL_KEY=... node scripts/seal-content.mjs unseal-all
 *   node scripts/seal-content.mjs check
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
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

function key() {
  const raw = process.env.CONTENT_SEAL_KEY;
  if (!raw) {
    console.error('✖ CONTENT_SEAL_KEY is not set.');
    console.error('  Generate one with: node scripts/seal-content.mjs keygen');
    process.exit(1);
  }
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length !== 32) {
    console.error(`✖ CONTENT_SEAL_KEY must decode to 32 bytes, got ${bytes.length}.`);
    process.exit(1);
  }
  return bytes;
}

/**
 * AES-256-GCM. Authenticated on purpose: without the tag, a tampered blob
 * would decrypt to garbage and be published as a post.
 */
function seal(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${body.toString('base64')}\n`;
}

function unseal(blob) {
  const [iv, tag, body] = blob.trim().split('.');
  if (!iv || !tag || !body) throw new Error('malformed sealed file');

  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));

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
 */
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
  const pattern = new RegExp(`${GITIGNORE_START}[\\s\\S]*?${GITIGNORE_END}`, 'm');

  writeFileSync(
    path,
    pattern.test(current) ? current.replace(pattern, block) : `${current.trimEnd()}\n\n${block}\n`
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
      console.log('Store as CONTENT_SEAL_KEY — a GitHub Actions secret, and somewhere you');
      console.log('will still have it in a year. Losing it means losing every sealed post.');
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
