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
      if (!target) throw new Error('usage: seal <path>');
      sealFile(target);
      unlinkSync(target);
      console.log(`✓ Sealed ${relative('.', target)} → ${VAULT}/${blobName(target)}`);
      console.log('  The plaintext is removed. The blob name reveals nothing about it.');
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

    case 'status': {
      const files = blobs();
      console.log(`${files.length} sealed file(s) in ${VAULT}`);
      if (hasKey() && files.length > 0) {
        for (const file of files) console.log(`  ${openBlob(file).path}`);
      } else if (files.length > 0) {
        console.log('  (set CONTENT_SEAL_KEY to list what they are)');
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
      console.error('Usage: seal-content.mjs <keygen|seal|unseal-all|status|check|is-sealed|migrate-v1> [path]');
      process.exit(1);
  }
} catch (error) {
  console.error(`✖ ${error.message}`);
  process.exit(1);
}
