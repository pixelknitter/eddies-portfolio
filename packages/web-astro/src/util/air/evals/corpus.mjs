import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseFrontmatter } from '@eddie/obsidian-publish-core';

/**
 * Builds the eval corpus from disk, the way `api/air/ask.ts` builds it from
 * collections.
 *
 * ## Why this module exists
 *
 * There were three implementations of "the corpus": the endpoint's, the offline
 * suite's, and the live harness's. Two of them drifted. When the resume landed
 * it was added to the endpoint and to neither eval layer, so the harness graded
 * a prompt the site does not build — the precise failure `loadCollection` in
 * `scripts/air-eval.mjs` already carried a comment warning about, one collection
 * too late.
 *
 * The drift was silent and total: both eval layers used a flat `readdirSync`,
 * and the resume is nested (`experience/`, `education/`, …), so the suite
 * reported "no real STAR stories on disk" and skipped every case while real,
 * answerable resume content sat one directory down. The evals were not weak;
 * they were not running.
 *
 * One loader, used by both, is the only version of this that cannot drift again.
 *
 * ## Two rules it inherits from production
 *
 * **Recurse, but never into a dot-directory.** `content.config.ts` globs
 * `**​/[!_]*.md`, which descends through subdirectories and skips dotted ones.
 * That second half is load-bearing: `.local-*​/` holds the editable working
 * copies of sealed content, and a build-time unseal writes the real file to the
 * real collection path. Traversing dot-directories would grade content no
 * visitor is ever served, and would do it only on the machine that happens to
 * hold the working copies.
 *
 * **A body means different things in different collections.** A STAR body is an
 * honesty guardrail — a rule about how a claim may be phrased — which
 * `buildUserMessage` hoists outside the story tags. A project or resume body is
 * narrative. `ask.ts` draws this line where the collection is still known, and
 * so does this; nothing downstream guesses.
 */

/**
 * The collections the endpoint answers from, and how each labels its body.
 *
 * `idPrefix` mirrors `ask.ts`, which namespaces resume ids so a citation is
 * traceable to the collection it came from.
 *
 * @type {ReadonlyArray<{name: string, bodyAs: 'constraints' | 'content', idPrefix?: string}>}
 */
const COLLECTIONS = Object.freeze([
  { name: 'star', bodyAs: 'constraints' },
  { name: 'projects', bodyAs: 'content' },
  { name: 'resume', bodyAs: 'content', idPrefix: 'resume/' },
]);

/**
 * Every markdown file under `dir`, as paths relative to it.
 *
 * @param {string} dir
 * @param {string} [prefix] Accumulated relative path during recursion.
 * @returns {string[]}
 */
function markdownFilesIn(dir, prefix = '') {
  /** @type {string[]} */
  const found = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Matches `[!_]` in the production glob, and keeps `.local-*​/` out.
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      found.push(...markdownFilesIn(join(dir, entry.name), relative));
    } else if (entry.name.endsWith('.md')) {
      found.push(relative);
    }
  }

  return found;
}

/**
 * Load the corpus the endpoint would answer from.
 *
 * Fixtures are excluded rather than fallen back to. An earlier version of the
 * offline suite fell back to `sample-*` when no real story was on disk, and
 * `sample-team-growth` then matched a boundary case the real stories correctly
 * decline — failing a deploy over content production does not have. With no real
 * content there is legitimately nothing to grade, so the answer is an empty
 * corpus and a skipped suite, not an invented subject.
 *
 * @param {string} contentRoot Absolute path to `src/content`.
 * @returns {Array<{id: string, data: Record<string, unknown>, constraints?: string, content?: string}>}
 */
export function loadEvalCorpus(contentRoot) {
  const corpus = [];

  for (const { name, bodyAs, idPrefix = '' } of COLLECTIONS) {
    const dir = join(contentRoot, name);
    // A fork pull request has no seal key and so no content at all. That must
    // skip the evals, not crash the suite.
    if (!existsSync(dir)) continue;

    for (const relative of markdownFilesIn(dir)) {
      const id = relative.replace(/\.md$/, '');

      // The fixture check is on the file's own name, not the path: the resume
      // ships `experience/sample-current-role.md`, so testing the whole
      // relative path would let every nested fixture through.
      if (id.split('/').pop()?.startsWith('sample-')) continue;

      const parsed = parseFrontmatter(readFileSync(join(dir, relative), 'utf8'));
      const body = parsed.body?.trim() || undefined;

      corpus.push({
        id: `${idPrefix}${id}`,
        data: parsed.frontmatter,
        ...(body ? { [bodyAs]: body } : {}),
      });
    }
  }

  return corpus;
}
