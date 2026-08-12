import { isRenderable, stageOf } from './stage.mjs';

/**
 * Publication rules for blog posts.
 *
 * A post is visible when it is not a draft *and* its publishDate has passed.
 * Because the site renders per request on Workers, this is evaluated on every
 * visit — a scheduled post goes live the moment its date passes, with no
 * rebuild, cron, or deploy involved.
 *
 * Plain ESM so the queue CLI can import it with bare node.
 */

/**
 * Is this post publicly visible right now?
 *
 * @param {{stage?: string, draft?: boolean, publishDate?: Date | string | null}} data
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isPublished(data, now = new Date()) {
  // Two independent questions, composed: has it reached the stage the site
  // renders, and has its date arrived. `reviewed` fails the first — it is
  // citable by A.I.R. and deliberately not rendered. See util/stage.mjs.
  return isRenderable(data) && isDue(data, now);
}

/**
 * Has this entry's date arrived? Nothing about its stage.
 *
 * Split out because the corpus needs the date rule *without* the render rule:
 * a `reviewed` post is quotable, but a post dated in the future must not be
 * read out early whatever its stage — that would publish it in prose to anyone
 * who asked the right question. Folding the two together made every reviewed
 * post uncitable, which is the exact opposite of what the stage is for.
 *
 * @param {{publishDate?: Date | string | null}} data
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isDue(data, now = new Date()) {
  if (!data.publishDate) return true; // undated entries are due immediately
  return new Date(data.publishDate).getTime() <= now.getTime();
}

/**
 * Is this post written and dated, but not yet due?
 *
 * @param {{draft?: boolean, publishDate?: Date | string | null}} data
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isScheduled(data, now = new Date()) {
  // A reviewed entry is not "scheduled" — it has no date to wait for and no
  // page to appear on. Only a published-and-dated entry is waiting.
  if (!isRenderable(data)) return false;
  if (!data.publishDate) return false;
  return new Date(data.publishDate).getTime() > now.getTime();
}

/**
 * Published posts, newest first.
 *
 * @template {{data: {draft?: boolean, publishDate?: Date | string | null}}} T
 * @param {T[]} entries
 * @param {Date} [now]
 * @returns {T[]}
 */
export function publishedPosts(entries, now = new Date()) {
  return entries
    .filter((entry) => isPublished(entry.data, now))
    .sort((a, b) => publishTime(b) - publishTime(a));
}

/**
 * Scheduled-but-not-yet-live posts, soonest first. Drives the queue view.
 *
 * @template {{data: {draft?: boolean, publishDate?: Date | string | null}}} T
 * @param {T[]} entries
 * @param {Date} [now]
 * @returns {T[]}
 */
export function scheduledPosts(entries, now = new Date()) {
  return entries
    .filter((entry) => isScheduled(entry.data, now))
    .sort((a, b) => publishTime(a) - publishTime(b));
}

/** @param {{data: {publishDate?: Date | string | null}}} entry */
function publishTime(entry) {
  return entry.data.publishDate ? new Date(entry.data.publishDate).getTime() : 0;
}
