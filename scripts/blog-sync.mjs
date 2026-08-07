#!/usr/bin/env node
/**
 * Sync the Obsidian vault's blog notes into the repo — import, then seal.
 *
 * One command from "edited in Obsidian" to "sealed in the repo":
 *
 *   CONTENT_SEAL_KEY="$(<~/.config/eddies-portfolio/content-seal.token)" \
 *     OBSIDIAN_VAULT="$HOME/Documents/second-brain-sync" yarn blog:sync
 *
 * (Both exports can live in .envrc; the key by path, never the literal.)
 *
 * For every non-underscore note in `<vault>/writing/blog/`:
 *
 *   1. Import with --force (title, tags, domain, hook, related all map;
 *      defaults fill the required fields; draft unless the note publishes).
 *   2. Decide what the imported file is:
 *      - unchanged from its working copy → delete the plaintext again; the
 *        blob is already current. Re-sealing anyway would mint new
 *        ciphertext for identical content (random IV) and churn the vault
 *        on every sync.
 *      - changed, and unpublished → seal it (blob + .local working copy).
 *      - published (draft: false, no future publishDate) → leave the
 *        plaintext; published content is public by definition.
 *
 * The key is required up front when any note is unpublished — failing after
 * a partial import would leave plaintext drafts sitting at real paths,
 * which is exactly the state everything here exists to prevent.
 *
 * This script is the interim workflow; the real answer is an Obsidian
 * plugin over obsidian-publish-core — see
 * packages/obsidian-publish-core/docs/PLUGIN-SPEC.md.
 */

import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  readdirSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import { join, basename } from 'node:path';

const VAULT = process.env.OBSIDIAN_VAULT;
if (!VAULT) {
  console.error('✖ OBSIDIAN_VAULT is not set.');
  console.error('  export OBSIDIAN_VAULT="$HOME/path/to/your/vault"  (e.g. in .envrc)');
  process.exit(1);
}

const NOTES_DIR = join(VAULT, 'writing', 'blog');
if (!existsSync(NOTES_DIR)) {
  console.error(`✖ ${NOTES_DIR} does not exist — is OBSIDIAN_VAULT right?`);
  process.exit(1);
}

const BLOG_DIR = 'packages/web-astro/src/content/blog';
const LOCAL_DIR = join(BLOG_DIR, '.local-blog');

const notes = readdirSync(NOTES_DIR).filter(
  (name) => name.endsWith('.md') && !name.startsWith('_'),
);
if (notes.length === 0) {
  console.log('No notes to sync.');
  process.exit(0);
}

/** Unpublished means draft, or scheduled for the future — the audit's rule. */
function isUnpublished(text) {
  const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  if (/^draft:\s*(true|"true")\s*$/m.test(fm)) return true;
  const date = fm.match(/^publishDate:\s*"?([^"\n]+)"?\s*$/m)?.[1];
  return date ? new Date(date) > new Date() : false;
}

// Fail before importing anything, not after — a partial run must not strand
// plaintext drafts at real paths.
if (!process.env.CONTENT_SEAL_KEY?.trim()) {
  console.error('✖ CONTENT_SEAL_KEY is not set — sync seals unpublished notes.');
  console.error('  CONTENT_SEAL_KEY="$(<~/.config/eddies-portfolio/content-seal.token)" yarn blog:sync');
  process.exit(1);
}

const summary = { sealed: [], unchanged: [], published: [] };

for (const note of notes) {
  const out = execFileSync(
    'node',
    ['scripts/obsidian-import.mjs', join(NOTES_DIR, note), '--vault', VAULT, '--force'],
    { encoding: 'utf8' },
  );
  const imported = out.match(/output\s+(\S+\.md)/)?.[1];
  if (!imported || !existsSync(imported)) {
    throw new Error(`${note}: could not find the imported file in the importer's output`);
  }

  const content = readFileSync(imported, 'utf8');
  const workingCopy = join(LOCAL_DIR, basename(imported));

  if (!isUnpublished(content)) {
    summary.published.push(basename(imported));
    continue;
  }

  if (existsSync(workingCopy) && readFileSync(workingCopy, 'utf8') === content) {
    unlinkSync(imported);
    summary.unchanged.push(basename(imported));
    continue;
  }

  execFileSync('node', ['scripts/seal-content.mjs', 'seal', imported], {
    encoding: 'utf8',
    env: process.env,
  });
  summary.sealed.push(basename(imported));
}

for (const [label, items] of Object.entries(summary)) {
  if (items.length > 0) console.log(`  ${label}: ${items.join(', ')}`);
}
if (summary.sealed.length > 0) {
  console.log('\nSealed notes are staged — commit the vault to publish the change.');
} else {
  console.log('\nNothing new to seal.');
}
