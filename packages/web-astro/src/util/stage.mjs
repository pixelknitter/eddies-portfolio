/**
 * Where a piece of content is in its life, and who may see it.
 *
 * `draft` was a binary: not ready for anything, or on the website. That left no
 * way to say the true and useful thing about most of this corpus — *this is
 * accurate, cite it, the page is not finished*. Ten of ten STAR stories and
 * seventeen of eighteen projects sat at `draft: true` for exactly that reason,
 * which meant A.I.R. answered from the résumé alone while the richest material
 * in the repository was a flag away and invisible.
 *
 * ## The three stages
 *
 * | stage       | site renders | A.I.R. may cite | means                          |
 * | ----------- | ------------ | --------------- | ------------------------------ |
 * | `draft`     | no           | no              | not ready for anything         |
 * | `reviewed`  | no           | **yes**         | accurate; the page is unfinished |
 * | `published` | yes          | yes             | live                           |
 *
 * ## Why `draft` still works
 *
 * The content is sealed, so migrating every entry needs the seal key and an
 * operator — and promoting an entry to `reviewed` is a judgement about whether
 * it is *true enough to quote*, which is not a thing a migration script can
 * decide. So `stage` is optional and `draft` remains a fallback: an entry is
 * read at whichever it declares, and entries are promoted one at a time as they
 * are actually reviewed.
 *
 * `stage` wins where both are present. Deleting `draft` is a later change, once
 * nothing declares it.
 *
 * Plain ESM so the queue CLI can import it with bare node.
 */

/** @typedef {'draft' | 'reviewed' | 'published'} Stage */

/** In lifecycle order. Exported so a schema and a test read the same list. */
export const STAGES = Object.freeze(['draft', 'reviewed', 'published']);

/**
 * The stage an entry is at.
 *
 * Falls back to `draft` for the legacy boolean, which is the fail-closed
 * direction: an entry nobody has classified is one nobody has approved. An
 * unrecognised `stage` value falls back the same way rather than being trusted
 * — the schema rejects those at build time, so reaching this means something
 * bypassed it.
 *
 * @param {{stage?: string, draft?: boolean}} [data]
 * @returns {Stage}
 */
export function stageOf(data = {}) {
  if (typeof data.stage === 'string' && STAGES.includes(data.stage)) {
    return /** @type {Stage} */ (data.stage);
  }
  return data.draft === true ? 'draft' : 'published';
}

/**
 * May A.I.R. draw on this entry?
 *
 * The whole point of `reviewed`: everything except an unreviewed draft. Note
 * this says nothing about *scheduling* — a post dated in the future is
 * answerable once reviewed, because the record of the work is true before the
 * post about it is due. `corpus.mjs` layers the publish rule on top where that
 * matters.
 *
 * @param {{stage?: string, draft?: boolean}} [data]
 * @returns {boolean}
 */
export function isCitable(data = {}) {
  return stageOf(data) !== 'draft';
}

/**
 * Does the site render this entry at all?
 *
 * Deliberately not "is it published *right now*" — `publishDate` is a separate
 * question and belongs to `isPublished` in posts.mjs, which composes the two.
 *
 * @param {{stage?: string, draft?: boolean}} [data]
 * @returns {boolean}
 */
export function isRenderable(data = {}) {
  return stageOf(data) === 'published';
}
