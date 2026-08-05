import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every `related` entry must point at an entry that exists.
 *
 * This spec is the validation layer the schema deliberately does not attempt:
 * `related` holds collection-qualified paths (`projects/knotty-brain`), not
 * `reference()`s, because a reference only tags the string with a collection
 * at parse time — nothing resolves this field at render, so a broken
 * reference passes the build silently (verified before the design landed).
 *
 * A target counts as existing when its markdown lives at the real path *or*
 * as a `.local-<collection>/` working copy — sealed entries have no plaintext
 * at the real path in a keyless checkout, and a link to one is still a valid
 * link. What this cannot see is a target that exists only as a sealed blob
 * with no working copy; `content:status` calls that state out instead.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT = join(HERE, '..', 'content');

/** Collections that participate in the `related` convention. */
const COLLECTIONS = ['projects', 'blog'] as const;

function entryFiles(collection: string): string[] {
  const dir = join(CONTENT, collection);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md') && !name.startsWith('_'))
    .map((name) => join(dir, name));
}

/** Slugs available as a target: real files plus .local-* working copies. */
function targetSlugs(collection: string): Set<string> {
  const dir = join(CONTENT, collection);
  const slugs = new Set<string>();
  for (const file of entryFiles(collection)) {
    slugs.add(basename(file, '.md'));
  }
  const local = join(dir, `.local-${collection}`);
  if (existsSync(local)) {
    for (const name of readdirSync(local)) {
      if (name.endsWith('.md') && !name.startsWith('_')) {
        slugs.add(basename(name, '.md'));
      }
    }
  }
  return slugs;
}

/** Pull the `related` list out of a file's frontmatter, tolerating inline and block arrays. */
function relatedOf(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return [];
  const block = fm[1].match(/^related:\s*(\[[\s\S]*?\]|\n(?:\s+-\s+.*\n?)+)/m);
  if (!block) return [];
  return [...block[1].matchAll(/['"]?([a-z0-9-]+\/[a-z0-9-]+)['"]?/g)].map(
    (m) => m[1],
  );
}

describe('related references', () => {
  const targets = new Map(COLLECTIONS.map((c) => [c as string, targetSlugs(c)]));

  for (const collection of COLLECTIONS) {
    it(`every ${collection} related entry points at an entry that exists`, () => {
      for (const file of entryFiles(collection)) {
        for (const ref of relatedOf(file)) {
          const [targetCollection, slug] = ref.split('/');
          const known = targets.get(targetCollection);
          expect(
            known,
            `${basename(file)}: unknown collection in "${ref}"`,
          ).toBeDefined();
          expect(
            known?.has(slug),
            `${basename(file)}: related target "${ref}" does not exist`,
          ).toBe(true);
        }
      }
    });

    it(`no ${collection} entry relates to itself`, () => {
      for (const file of entryFiles(collection)) {
        const self = `${collection}/${basename(file, '.md')}`;
        expect(
          relatedOf(file).includes(self),
          `${basename(file)} relates to itself`,
        ).toBe(false);
      }
    });
  }
});
