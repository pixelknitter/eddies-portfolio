#!/usr/bin/env node
/**
 * Seal content that must not be readable in a public repo.
 *
 * The `publishDate` gate stops a scheduled post being *served* early. It does
 * nothing for the repo, where markdown is readable on GitHub the moment it is
 * committed. Sealing closes that: blobs are committed, CI decrypts at build
 * time with a key that never leaves the secret store.
 *
 * ## Filenames are part of the payload
 *
 * A blob called `data-driven-android-launch-ticketfly.md.sealed` gives away
 * the employer, the platform and the theme. Encrypting the body while leaving
 * that in the tree undoes most of the point, so each blob is named
 * `HMAC(key, path)` and the real path is encrypted *inside* it. The name is
 * deterministic, so re-sealing a file produces the same blob name and diffs
 * stay stable, and unguessable without the key, so nobody can confirm a topic
 * by guessing at it. Collection membership is hidden too — blobs live in one
 * flat vault directory rather than under `star/` or `blog/`.
 *
 * ## One salt, derived once
 *
 * scrypt costs ~85ms per derivation. A per-file salt makes that linear: ten
 * files is a second, a hundred is eight. Measured, not assumed. So the salt is
 * per-repository, stored in the manifest, and the key is derived once per run;
 * each blob still gets its own random IV, which is what AES-GCM actually
 * requires. Salts are not secrets — their job is to stop precomputation
 * against a passphrase, and one per repo does that.
 *
 * ## What this protects
 *
 * The repository. A decrypted post lives in the Worker's server bundle, which
 * is not publicly downloadable and is governed by `publishDate`. Rotating the
 * key does not un-publish anything: old blobs remain in git history, so treat
 * a leaked key as "everything ever sealed with it is public".
 *
 * Usage:
 *   node scripts/seal-content.mjs keygen
 *   CONTENT_SEAL_KEY=… node scripts/seal-content.mjs seal <path>
 *   CONTENT_SEAL_KEY=… node scripts/seal-content.mjs unseal-all [--require-key]
 *   CONTENT_SEAL_KEY=… node scripts/seal-content.mjs status
 *   CONTENT_SEAL_KEY=… node scripts/seal-content.mjs check
 *   CONTENT_SEAL_KEY=… node scripts/seal-content.mjs is-sealed <path>
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from 'node:crypto';
import { parseFrontmatter } from '../packages/obsidian-publish-core/src/index.mjs';
import { readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

const CONTENT_ROOT = 'packages/web-astro/src/content';
const VAULT = 'packages/web-astro/content-vault';
const MANIFEST = join(VAULT, 'manifest.json');
const FORMAT_VERSION = 2;
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const args = process.argv.slice(2);
const [command, target] = args.filter((arg) => !arg.startsWith('--'));
const requireKey = args.includes('--require-key');

const hasKey = () => Boolean(process.env.CONTENT_SEAL_KEY?.trim());

function passphrase() {
  if (!hasKey()) {
    console.error('✖ CONTENT_SEAL_KEY is not set.');
    console.error('  Suggestion: node scripts/seal-content.mjs keygen');
    console.error('  Any long passphrase works — it is stretched with scrypt.');
    process.exit(1);
  }
  return process.env.CONTENT_SEAL_KEY;
}

/** Read the manifest, creating one with a fresh salt on first seal. */
function manifest({ create = false } = {}) {
  if (existsSync(MANIFEST)) {
    const parsed = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    if (parsed.v !== FORMAT_VERSION) {
      throw new Error(
        `vault is format v${parsed.v}; this build understands v${FORMAT_VERSION}. Run \`migrate\`.`
      );
    }
    return parsed;
  }
  if (!create) return undefined;

  /**
   * Refuse to mint a fresh salt while sealed blobs already exist.
   *
   * A shared salt is what makes one scrypt derivation cover the whole vault,
   * but it means the manifest is load-bearing: regenerate it and every
   * existing blob is orphaned, because their key can no longer be derived.
   * That is exactly what happened once — the manifest went missing during a
   * branch rollback, the next `seal` silently created a new salt, and ten
   * sealed stories became undecryptable until the old salt was recovered from
   * git history.
   *
   * Silence was the bug. A missing manifest beside existing blobs is a
   * recoverable accident if you stop, and a data-loss event if you carry on.
   */
  const orphans = existsSync(VAULT)
    ? readdirSync(VAULT).filter((file) => file.endsWith('.sealed'))
    : [];

  if (orphans.length > 0) {
    throw new Error(
      `${orphans.length} sealed blob(s) exist but ${MANIFEST} is missing.\n` +
        '  Creating a new salt now would orphan every one of them — their key is\n' +
        '  derived from the salt in that file.\n\n' +
        '  Recover the manifest first:\n' +
        `    git checkout HEAD -- ${MANIFEST}\n` +
        `    git log --all --oneline -- ${MANIFEST}   # if HEAD does not have it\n\n` +
        '  Only if the blobs are genuinely disposable, delete them and seal again.'
    );
  }

  mkdirSync(VAULT, { recursive: true });
  const fresh = { v: FORMAT_VERSION, kdf: 'scrypt', algo: 'aes-256-gcm', salt: randomBytes(16).toString('hex') };
  writeFileSync(MANIFEST, `${JSON.stringify(fresh, null, 2)}\n`);
  return fresh;
}

/** Derived once per process — this is the expensive step. */
let cachedKey;
function key(create = false) {
  if (!cachedKey) {
    const state = manifest({ create });
    if (!state) throw new Error('no sealed content yet');
    cachedKey = scryptSync(passphrase(), Buffer.from(state.salt, 'hex'), 32, SCRYPT);
  }
  return cachedKey;
}

/** Deterministic, unguessable blob name for a content path. */
const blobName = (path) => `${createHmac('sha256', key()).update(path).digest('hex').slice(0, 32)}.sealed`;
const blobPath = (path) => join(VAULT, blobName(path));

function sealFile(path) {
  key(true);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  // The path travels inside the ciphertext — that is what lets the blob name
  // be opaque and still be restorable.
  const payload = JSON.stringify({ path, content: readFileSync(path, 'utf8') });
  const data = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);

  writeFileSync(
    blobPath(path),
    `${JSON.stringify({ iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: data.toString('base64') }, null, 2)}\n`
  );
}

function openBlob(file) {
  const envelope = JSON.parse(readFileSync(join(VAULT, file), 'utf8'));
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(envelope.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));

  try {
    const plain = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plain);
  } catch {
    throw new Error('could not decrypt — wrong CONTENT_SEAL_KEY, or the blob was altered');
  }
}

const blobs = () =>
  existsSync(VAULT) ? readdirSync(VAULT).filter((file) => file.endsWith('.sealed')) : [];

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
    case 'keygen':
      console.log(randomBytes(32).toString('base64'));
      console.log('\nA suggestion — CONTENT_SEAL_KEY is a passphrase, stretched with scrypt.');
      console.log('Store it in a password manager AND as a GitHub Actions secret.');
      console.log('Losing it means losing every sealed file.');
      break;

    case 'seal': {
      if (!target) throw new Error('usage: seal <path> [--remove]');
      sealFile(target);

      // The plaintext stays. Deleting it made the blob the *only* copy, which
      // meant editing a post required unsealing it first and the local working
      // copy of your own draft was an opaque blob. The blob is the committed
      // artifact; the markdown is the source you edit.
      //
      // It is not committed because the pre-commit hook refuses it and `audit`
      // fails CI if it slips through — enforcement rather than deletion.
      if (args.includes('--remove')) unlinkSync(target);

      console.log(`✓ Sealed ${relative('.', target)} → ${VAULT}/${blobName(target)}`);
      console.log(
        args.includes('--remove')
          ? '  Plaintext removed as requested.'
          : '  Plaintext kept for editing — the hook stops it being committed.'
      );
      break;
    }

    // Single-file unseal, for editing one thing without restoring the whole
    // vault. Its absence cost real time during a recovery: the docs referenced
    // it, the CLI did not have it, and the failure was a usage line rather
    // than an error — so a scripted recovery step silently did nothing.
    case 'unseal': {
      if (!target) throw new Error('usage: unseal <content-path>');
      const blob = blobPath(target);
      if (!existsSync(blob)) throw new Error(`no sealed blob for ${target}`);

      const { path, content } = openBlob(blobName(target));
      writeFileSync(path, content);
      console.log(`✓ Unsealed ${path}`);
      break;
    }

    case 'unseal-all': {
      const files = blobs();
      if (files.length === 0) {
        console.log('No sealed content. Nothing to do.');
        break;
      }
      // Fork pull requests cannot read the secret. Failing there blocks a
      // contribution over content it has no business seeing, so warn and build
      // without it. Deploys pass --require-key, where missing must be fatal.
      if (!hasKey()) {
        const message = `${files.length} sealed file(s) but CONTENT_SEAL_KEY is not set`;
        if (requireKey) throw new Error(`${message} — refusing to deploy without them`);
        console.warn(`⚠ ${message}; building without them.`);
        break;
      }
      for (const file of files) {
        const { path, content } = openBlob(file);
        writeFileSync(path, content);
        console.log(`✓ ${path}`);
      }
      console.log(`Unsealed ${files.length} file(s).`);
      break;
    }

    // Answers "is this path sealed?" without revealing any other path — the
    // pre-commit hook's only question.
    case 'is-sealed': {
      if (!target) throw new Error('usage: is-sealed <path>');
      process.exit(existsSync(blobPath(target)) ? 0 : 1);
      break;
    }

    // Keeps the vault in sync with edits. Cheap by construction: one scrypt
    // derivation covers the run, and only files whose content actually changed
    // are re-encrypted — the rest are compared and skipped.
    case 'reseal-if-changed': {
      const files = blobs();
      if (files.length === 0 || !hasKey()) {
        if (files.length > 0) console.warn('⚠ CONTENT_SEAL_KEY not set; vault may be stale.');
        break;
      }

      let resealed = 0;
      for (const file of files) {
        const { path, content } = openBlob(file);
        if (!existsSync(path)) continue;          // not unsealed locally — nothing to compare
        if (readFileSync(path, 'utf8') === content) continue;

        sealFile(path);
        console.log(`✓ resealed ${path}`);
        resealed += 1;
      }
      console.log(resealed === 0 ? 'Vault already matches the working copy.' : `Resealed ${resealed} file(s).`);
      break;
    }

    /**
     * The rule that makes sealing a guarantee rather than a habit.
     *
     * `check` asks whether a sealed file's plaintext is also committed. That is
     * the wrong question on its own — it catches a mistake in sealing, not a
     * failure to seal at all. This asks the inverse: is any unpublished content
     * sitting in the repo as plaintext?
     *
     * Unpublished means `draft: true` or a `publishDate` in the future. Both
     * leak equally: the repo is public, so a scheduled post committed today is
     * readable today no matter what the site serves. Review tiers still show
     * this content — they unseal at build time — while production keeps it
     * hidden behind the publish gate.
     *
     * Needs no key: it reads frontmatter of files that are already public, so
     * it enforces on fork pull requests too, where `check` can only report.
     */
    case 'audit': {
      const now = new Date();

      /**
       * Deliberately exempt. This fixture's whole purpose is carrying a future
       * publishDate so the scheduling gate has something to gate; it holds
       * placeholder text and nothing private. Sealing it would leave forks with
       * an empty blog and demonstrate nothing.
       *
       * Keep this list at one entry. A second exemption is a sign the rule is
       * being worked around rather than followed.
       */
      const EXEMPT = new Set(['packages/web-astro/src/content/blog/sample-scheduled-post.md']);
      const tracked = execFileSync('git', ['ls-files', CONTENT_ROOT], { encoding: 'utf8' })
        .split('\n')
        .filter((path) => path.endsWith('.md') && !path.split('/').pop().startsWith('_'));

      const exposed = [];
      for (const path of tracked) {
        if (!existsSync(path)) continue;
        const { frontmatter } = parseFrontmatter(readFileSync(path, 'utf8'));

        const isDraft = frontmatter.draft === true || frontmatter.draft === 'true';
        const publishDate = frontmatter.publishDate ? new Date(frontmatter.publishDate) : undefined;
        const scheduled = publishDate instanceof Date && !isNaN(publishDate) && publishDate > now;

        if ((isDraft || scheduled) && !EXEMPT.has(path)) {
          exposed.push({ path, why: isDraft ? 'draft: true' : `publishDate ${frontmatter.publishDate}` });
        }
      }

      if (exposed.length > 0) {
        console.error('✖ Unpublished content is committed as plaintext:');
        for (const { path, why } of exposed) console.error(`  ${path}  (${why})`);
        console.error('');
        console.error('  This repository is public, so these are readable now regardless of');
        console.error('  what the site serves. Seal them:');
        console.error('');
        for (const { path } of exposed) console.error(`    node scripts/seal-content.mjs seal ${path}`);
        console.error('');
        console.error('  Review tiers still show sealed content — they unseal at build time.');
        process.exit(1);
      }

      console.log(`✓ ${tracked.length} tracked content file(s); none unpublished in plaintext.`);
      break;
    }

    case 'status': {
      const files = blobs();
      console.log(`${files.length} sealed file(s) in ${VAULT}`);

      if (files.length === 0) break;
      if (!hasKey()) {
        console.log('  (set CONTENT_SEAL_KEY to list what they are)');
        break;
      }

      // Three states worth telling apart. "modified" is the one that matters:
      // the blob no longer reflects the file, so a deploy would publish the
      // old text. `reseal-if-changed` fixes it; the pre-commit hook runs that
      // automatically.
      let modified = 0;
      for (const file of files) {
        const { path, content } = openBlob(file);
        const local = existsSync(path);
        const state = !local
          ? 'sealed only'
          : readFileSync(path, 'utf8') === content
            ? 'local copy matches'
            : 'LOCAL COPY MODIFIED — reseal needed';
        if (state.startsWith('LOCAL')) modified += 1;
        console.log(`  ${path}\n      ${state}`);
      }

      if (modified > 0) {
        console.log('');
        console.log(`⚠ ${modified} file(s) differ from their blob. Run:`);
        console.log('    node scripts/seal-content.mjs reseal-if-changed');
      }
      break;
    }

    case 'check': {
      const files = blobs();
      if (files.length === 0) {
        console.log('✓ No sealed content.');
        break;
      }
      if (!hasKey()) {
        console.log(`… ${files.length} sealed file(s); no key, cannot verify plaintext is absent.`);
        break;
      }
      const leaked = files.map((file) => openBlob(file).path).filter(isTracked);
      if (leaked.length > 0) {
        console.error('✖ Sealed content whose plaintext is also committed:');
        for (const path of leaked) console.error(`  ${path}`);
        console.error('\n  Sealing does nothing while the plaintext is in the repo.');
        process.exit(1);
      }
      console.log(`✓ ${files.length} sealed file(s); no plaintext committed.`);
      break;
    }

    // One-shot upgrade from the first per-file format, whose blobs sat beside
    // the content as `<name>.md.sealed` with a per-file salt — both the naming
    // that leaked topics and the derivation that scaled linearly.
    case 'migrate-v1': {
      const { createDecipheriv: decipherV1, scryptSync: scryptV1 } = await import('node:crypto');
      const { readdirSync: read, statSync } = await import('node:fs');

      const walk = function* (dir) {
        for (const entry of read(dir)) {
          const path = join(dir, entry);
          if (statSync(path).isDirectory()) yield* walk(path);
          else yield path;
        }
      };

      const legacy = [...walk(CONTENT_ROOT)].filter((file) => file.endsWith('.md.sealed'));
      if (legacy.length === 0) {
        console.log('No v1 blobs found. Nothing to migrate.');
        break;
      }

      console.log(`Migrating ${legacy.length} v1 blob(s) into the vault…`);
      for (const file of legacy) {
        const envelope = JSON.parse(readFileSync(file, 'utf8'));
        // v1 derived a key per file from its own salt.
        const legacyKey = scryptV1(passphrase(), Buffer.from(envelope.salt, 'hex'), 32, SCRYPT);
        const decipher = decipherV1('aes-256-gcm', legacyKey, Buffer.from(envelope.iv, 'hex'));
        decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));

        let content;
        try {
          content = Buffer.concat([
            decipher.update(Buffer.from(envelope.data, 'base64')),
            decipher.final(),
          ]).toString('utf8');
        } catch {
          throw new Error(`could not decrypt ${file} — is CONTENT_SEAL_KEY the one it was sealed with?`);
        }

        const path = file.slice(0, -'.sealed'.length);
        writeFileSync(path, content);
        sealFile(path);
        unlinkSync(path);
        unlinkSync(file);
        console.log(`✓ ${path} → ${VAULT}/${blobName(path)}`);
      }
      console.log(`\nMigrated ${legacy.length} file(s). Commit the vault and the removed blobs.`);
      break;
    }

    default:
      console.error('Usage: seal-content.mjs <keygen|seal|unseal-all|status|check|audit|is-sealed|migrate-v1> [path]');
      process.exit(1);
  }
} catch (error) {
  console.error(`✖ ${error.message}`);
  process.exit(1);
}
