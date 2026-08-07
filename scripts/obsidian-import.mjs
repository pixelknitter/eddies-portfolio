#!/usr/bin/env node
/**
 * Import an Obsidian note into the blog content collection.
 *
 * Conversion and frontmatter mapping live in
 * packages/obsidian-publish-core and are unit-tested; this script is only the
 * filesystem shell around them.
 *
 * Usage:
 *   node scripts/obsidian-import.mjs <note.md> [--vault <dir>] [--slug <slug>]
 *                                    [--publish] [--dry-run]
 *
 *   --vault     vault root, used to resolve embedded attachments
 *   --slug      output slug (defaults to a slugified title/filename)
 *   --publish   write draft: false (default is draft: true)
 *   --dry-run   print what would be written without touching disk
 *
 * Obsidian frontmatter maps to the blog schema as:
 *   title      <- title | first H1 | filename
 *   blurb      <- blurb | description | summary | first paragraph
 *   tags       <- frontmatter tags + inline #tags
 *   heroImage  <- hero | heroImage | cover  (copied into public/)
 *   author     <- author (defaults to eddie-freeman)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const APP = 'packages/web-astro';
const CONTENT_DIR = `${APP}/src/content/blog`;
const ASSET_DIR = `${APP}/public/blog-assets`;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const notePath = args.find((a) => !a.startsWith('--') && a.endsWith('.md'));
if (!notePath) {
  console.error('Usage: obsidian-import.mjs <note.md> [--vault dir] [--slug s] [--publish] [--dry-run]');
  process.exit(1);
}
if (!existsSync(notePath)) {
  console.error(`✖ No such note: ${notePath}`);
  process.exit(1);
}

const CORE = 'packages/obsidian-publish-core/src/index.mjs';
const { convertNote, slugify, toEntry, serialiseFrontmatter } = await import(
  pathToFileURL(resolve(CORE)).href
);



const raw = readFileSync(notePath, 'utf8');

// Known slugs let the converter decide which wikilinks can safely become links.
const knownSlugs = new Set(
  existsSync(CONTENT_DIR)
    ? readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md')).map((f) => basename(f, '.md'))
    : []
);

const converted = convertNote(raw, { knownSlugs });
const { assets } = converted;

// The site's required schema fields are supplied here, not baked into the
// package — it stays reusable by any Astro site.
const entry = toEntry(converted, {
  filename: basename(notePath),
  defaults: { author: 'eddie-freeman' },
  publish: has('publish'),
});

const title = entry.frontmatter.title;
const slug = flag('slug') || slugify(title);
const tags = entry.frontmatter.tags;
const heroFile = entry.heroAsset;

const vault = flag('vault') || dirname(notePath);
const dryRun = has('dry-run');

// Resolve an attachment anywhere under the vault — Obsidian embeds are by
// filename, not path.
function findInVault(root, filename, depth = 0) {
  if (depth > 6 || !existsSync(root)) return undefined;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(root, entry.name);
    if (entry.isFile() && entry.name === filename) return full;
    if (entry.isDirectory()) {
      const found = findInVault(full, filename, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

const toCopy = [...new Set([...assets, ...(heroFile ? [heroFile] : [])])];
const copied = [];
const missing = [];

for (const asset of toCopy) {
  const source = findInVault(vault, asset);
  if (!source) {
    missing.push(asset);
    continue;
  }
  copied.push({ from: source, to: join(ASSET_DIR, asset) });
}

// Fall back to the site's default hero when the note supplies none.
if (!entry.frontmatter.heroImage) {
  entry.frontmatter.heroImage = { url: '/blog-post.webp', alt: title };
}

const frontMatterOut = serialiseFrontmatter(entry.frontmatter);
const outBody = entry.body;
const outPath = join(CONTENT_DIR, `${slug}.md`);

console.log(`  note    ${notePath}`);
console.log(`  title   ${title}`);
console.log(`  slug    ${slug}`);
console.log(`  tags    ${tags.length ? tags.join(', ') : '(none)'}`);
console.log(`  draft   ${!has('publish')}`);
console.log(`  assets  ${copied.length} copied${missing.length ? `, ${missing.length} MISSING` : ''}`);
for (const m of missing) console.log(`    ⚠ not found in vault: ${m}`);
console.log(`  output  ${outPath}`);

if (dryRun) {
  console.log('\n--- dry run, nothing written ---\n');
  console.log(frontMatterOut + outBody);
  process.exit(missing.length ? 1 : 0);
}

if (existsSync(outPath) && !has('force')) {
  console.error(`✖ ${outPath} already exists. Pass --force to overwrite.`);
  process.exit(1);
}

mkdirSync(CONTENT_DIR, { recursive: true });
if (copied.length) mkdirSync(ASSET_DIR, { recursive: true });
for (const { from, to } of copied) copyFileSync(from, to);
writeFileSync(outPath, frontMatterOut + outBody);

console.log(`\n✓ Imported. Review it, then set draft: false to publish.`);
if (missing.length) {
  console.log('⚠ Some attachments were not found; fix those links before publishing.');
  process.exit(1);
}
