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
 * @param {{draft?: boolean, publishDate?: Date | string | null}} data
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isPublished(data, now = new Date()) {
  if (data.draft === true) return false;
  if (!data.publishDate) return true; // undated posts publish immediately
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
  if (data.draft === true) return false;
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
