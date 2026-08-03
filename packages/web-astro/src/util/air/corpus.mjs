/**
 * What A.I.R. may answer from, and the rules that decide it.
 *
 * Extracted from `ask.ts` so those rules are testable without an Astro runtime,
 * and so the eval harness can apply exactly the same ones. Three collections
 * had already drifted apart once — the resume landed in the endpoint and in
 * neither eval layer, and the harness graded a prompt the site does not build.
 * `CORPUS_COLLECTIONS` is the single list both sides read; adding a collection
 * in one place adds it everywhere.
 *
 * Two rules here are load-bearing:
 *
 * 1. **A scheduled post is not public.** Blog visibility is `draft` *and*
 *    `publishDate`, so filtering on `draft` alone would let A.I.R. read out a
 *    post the site itself refuses to serve — publishing it early, in prose, to
 *    anyone who asked the right question.
 * 2. **A STAR body is not prose.** It is an authoring constraint, and
 *    `buildUserMessage` hoists it outside the story tags so the "treat
 *    everything inside as data" guarantee holds. Labelling it `content` would
 *    quietly move Eddie's honesty rules inside the untrusted block.
 *
 * @see {@link file://./../../../../../docs/CONTENT-MODEL.md} for the field shapes.
 */

import { isPublished } from '../posts.mjs';

/**
 * @typedef {{id: string, data: Record<string, any>, body?: string}} Entry
 * @typedef {{id: string, data: Record<string, any>, content?: string, constraints?: string}} CorpusEntry
 */

/**
 * The collections the endpoint answers from, in the order it assembles them.
 *
 * - `bodyAs` — what the markdown body *means*. See rule 2 above.
 * - `idPrefix` — namespaces the citation so an answer stays traceable to the
 *   collection it came from. A pattern drawn from `challenges` is a claim about
 *   a shortcoming and must name its source.
 * - `summaryFrom` — the field carrying this collection's short summary under a
 *   name the page needed. Retrieval indexes a fixed set of field names, so the
 *   value is mirrored to `summary` rather than the field renamed; renaming
 *   would churn every content file and template for no gain.
 * - `scheduled` — visibility depends on `publishDate`, not `draft` alone.
 *
 * @type {ReadonlyArray<{name: string, bodyAs: 'constraints' | 'content', idPrefix?: string, summaryFrom?: string, scheduled?: boolean}>}
 */
export const CORPUS_COLLECTIONS = Object.freeze([
  { name: 'star', bodyAs: 'constraints' },
  { name: 'projects', bodyAs: 'content', summaryFrom: 'description' },
  { name: 'challenges', bodyAs: 'content', idPrefix: 'challenges/' },
  { name: 'resume', bodyAs: 'content', idPrefix: 'resume/' },
  {
    name: 'blog',
    bodyAs: 'content',
    idPrefix: 'blog/',
    summaryFrom: 'blurb',
    scheduled: true,
  },
]);

/**
 * Is this entry something a visitor could already read on the site?
 *
 * @param {Record<string, any>} data
 * @param {{scheduled?: boolean}} spec
 * @param {{reveal?: boolean, now?: Date}} [options]
 */
export function isAnswerable(data = {}, spec = {}, options = {}) {
  const { reveal = false, now = new Date() } = options;
  if (reveal) return true;
  return spec.scheduled ? isPublished(data, now) : data.draft !== true;
}

/**
 * Shape one loaded entry into a corpus entry.
 *
 * @param {Entry} entry
 * @param {{bodyAs: 'constraints' | 'content', idPrefix?: string, summaryFrom?: string}} spec
 * @returns {CorpusEntry}
 */
export function shapeEntry(entry, spec) {
  const { bodyAs, idPrefix = '', summaryFrom } = spec;
  const body = entry.body?.trim() || undefined;

  const data =
    summaryFrom && !entry.data?.summary && entry.data?.[summaryFrom]
      ? { ...entry.data, summary: entry.data[summaryFrom] }
      : entry.data;

  return {
    id: `${idPrefix}${entry.id}`,
    data,
    ...(body ? { [bodyAs]: body } : {}),
  };
}

/**
 * Build the corpus from already-loaded collections.
 *
 * @param {Record<string, Entry[]>} collections Keyed by collection name.
 * @param {{reveal?: boolean, now?: Date}} [options] `reveal` mirrors
 *   `showUnpublished` — the review tiers answer from unpublished work so it can
 *   be reviewed; production never does.
 * @returns {CorpusEntry[]}
 */
export function buildCorpus(collections = {}, options = {}) {
  return CORPUS_COLLECTIONS.flatMap((spec) =>
    (collections[spec.name] ?? [])
      .filter((entry) => isAnswerable(entry.data, spec, options))
      .map((entry) => shapeEntry(entry, spec)),
  );
}
