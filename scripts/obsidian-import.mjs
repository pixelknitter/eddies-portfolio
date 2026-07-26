#!/usr/bin/env node
/**
 * Import an Obsidian note into the blog content collection.
 *
 * Conversion logic lives in packages/web-astro/src/util/obsidian.mjs and is
 * unit-tested; this script is the filesystem and frontmatter-mapping shell
 * around it.
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

const { convertNote, slugify } = await import(
  pathToFileURL(resolve(`${APP}/src/util/obsidian.mjs`)).href
);



const raw = readFileSync(notePath, 'utf8');

// Known slugs let the converter decide which wikilinks can safely become links.
const knownSlugs = new Set(
  existsSync(CONTENT_DIR)
    ? readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md')).map((f) => basename(f, '.md'))
    : []
);

const { body, tags, assets, frontmatter } = convertNote(raw, { knownSlugs });

const firstHeading = /^#\s+(.+)$/m.exec(body)?.[1];
const title = String(frontmatter.title || firstHeading || basename(notePath, '.md')).trim();
const slug = flag('slug') || slugify(title);

const firstParagraph = body
  .split(/\n{2,}/)
  .map((p) => p.trim())
  .find((p) => p && !p.startsWith('#') && !p.startsWith('!') && !p.startsWith('>'));

const blurb = String(
  frontmatter.blurb || frontmatter.description || frontmatter.summary ||
  (firstParagraph ? firstParagraph.replace(/\s+/g, ' ').slice(0, 200) : title)
).trim();

const hero = frontmatter.hero || frontmatter.heroImage || frontmatter.cover;
const heroFile = hero ? basename(String(hero)) : undefined;

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

const frontMatterOut = [
  '---',
  `title: ${JSON.stringify(title)}`,
  'author: ' + JSON.stringify(String(frontmatter.author || 'eddie-freeman')),
  'relatedPosts: []',
  `blurb: ${JSON.stringify(blurb)}`,
  `tags: [${tags.map((t) => JSON.stringify(t)).join(', ')}]`,
  'heroImage:',
  `  url: ${JSON.stringify(heroFile ? `/blog-assets/${heroFile}` : '/blog-post.webp')}`,
  `  alt: ${JSON.stringify(title)}`,
  `draft: ${has('publish') ? 'false' : 'true'}`,
  '---',
  '',
].join('\n');

// Astro renders the frontmatter title as the page heading, so a leading H1 in
// the body would duplicate it.
const outBody = body.replace(/^#\s+.+\n+/, '');
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
