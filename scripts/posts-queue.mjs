#!/usr/bin/env node
/**
 * Show the publication queue: what is live, what is scheduled, what is still
 * a draft.
 *
 * Usage:
 *   node scripts/posts-queue.mjs            # everything, grouped
 *   node scripts/posts-queue.mjs --next     # just the next post due
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const APP = 'packages/web-astro';
const BLOG_DIR = `${APP}/src/content/blog`;

const { isPublished, isScheduled } = await import(
  pathToFileURL(resolve(`${APP}/src/util/posts.mjs`)).href
);

if (!existsSync(BLOG_DIR)) {
  console.error(`✖ No blog directory at ${BLOG_DIR}`);
  process.exit(1);
}

/** Minimal frontmatter read — enough for title, draft and publishDate. */
function readPost(file) {
  const raw = readFileSync(join(BLOG_DIR, file), 'utf8');
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1] ?? '';
  const field = (name) =>
    new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(block)?.[1]?.trim().replace(/^["']|["']$/g, '');

  return {
    slug: basename(file, '.md'),
    title: field('title') ?? basename(file, '.md'),
    draft: field('draft') === 'true',
    publishDate: field('publishDate') ?? null,
  };
}

const posts = readdirSync(BLOG_DIR)
  .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
  .map(readPost);

const now = new Date();
const entries = posts.map((data) => ({ data }));

const live = entries.filter((e) => isPublished(e.data, now)).map((e) => e.data);
const queued = entries
  .filter((e) => isScheduled(e.data, now))
  .map((e) => e.data)
  .sort((a, b) => new Date(a.publishDate) - new Date(b.publishDate));
const drafts = posts.filter((p) => p.draft);

const when = (iso) =>
  new Date(iso).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

if (process.argv.includes('--next')) {
  if (!queued.length) {
    console.log('Nothing scheduled.');
    process.exit(0);
  }
  const next = queued[0];
  console.log(`${next.title} — ${when(next.publishDate)} (${next.slug})`);
  process.exit(0);
}

console.log(`\nLive (${live.length})`);
for (const p of live) {
  console.log(`  ✓ ${p.title}${p.publishDate ? `  ${when(p.publishDate)}` : '  (undated)'}`);
}

console.log(`\nScheduled (${queued.length})`);
if (!queued.length) console.log('  —');
for (const p of queued) {
  console.log(`  ◷ ${when(p.publishDate)}  ${p.title}`);
}

console.log(`\nDrafts (${drafts.length})`);
if (!drafts.length) console.log('  —');
for (const p of drafts) {
  console.log(`  ✎ ${p.title}  (${p.slug})`);
}

console.log(
  '\nScheduled posts publish themselves — the site renders per request, so no' +
    '\ndeploy is needed when a date passes.\n'
);
