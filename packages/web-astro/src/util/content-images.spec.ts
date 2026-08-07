import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every local image a content entry references must exist in `public/`.
 *
 * A frontmatter path to a file that does not exist renders as a broken image
 * with its alt text spilling into the card — which is exactly how the first
 * featured shelf shipped, because nothing failed. The schema made images
 * *optional* so an entry without artwork renders a clean text card; this
 * spec closes the other half: an entry that names artwork must name artwork
 * that exists. Planned-but-unmade art belongs in the diagram inventory, not
 * in frontmatter.
 *
 * External URLs (the fixtures use placehold.co) are not checked — only
 * root-relative paths that would be served from `public/`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');
const CONTENT = join(SRC, 'content');
const PUBLIC = join(SRC, '..', 'public');

/** Collections whose entries carry image frontmatter. */
const COLLECTIONS = ['projects', 'blog'];

const IMAGE_KEYS = /^(?: {2})?url: '(\/[^']+)'/;

function contentFiles(collection: string): string[] {
  const dir = join(CONTENT, collection);
  const files: string[] = [];
  if (!existsSync(dir)) return files;
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.md') && !name.startsWith('_')) files.push(join(dir, name));
  }
  const local = join(dir, `.local-${collection}`);
  if (existsSync(local)) {
    for (const name of readdirSync(local)) {
      if (name.endsWith('.md') && !name.startsWith('_')) files.push(join(local, name));
    }
  }
  return files;
}

describe('content image references', () => {
  for (const collection of COLLECTIONS) {
    it(`every local image referenced by ${collection} exists in public/`, () => {
      for (const file of contentFiles(collection)) {
        const fm = readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/);
        if (!fm) continue;
        for (const line of fm[1].split('\n')) {
          const m = line.match(IMAGE_KEYS) ?? line.match(/url: "(\/[^"]+)"/);
          if (!m) continue;
          expect(
            existsSync(join(PUBLIC, m[1])),
            `${basename(file)} references ${m[1]}, which does not exist in public/`,
          ).toBe(true);
        }
      }
    });
  }
});
