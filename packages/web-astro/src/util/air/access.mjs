/**
 * Access control and spend bounds for A.I.R.
 *
 * A.I.R. is anonymous inference on a paid model reachable from the public
 * internet, which makes it a spend surface before it is a feature. Two
 * independent bounds, because either alone fails badly:
 *
 *   - An access code bounds *who* can ask. Handed out at a conference, it
 *     keeps the endpoint public-but-not-crawlable.
 *   - A rate limit bounds *how fast*, including for someone holding the code.
 *
 * The limiter is per-isolate and therefore best-effort: Cloudflare may run
 * several isolates for one Worker, so the effective ceiling is the configured
 * rate times the isolate count. That is a real limitation, stated here rather
 * than papered over — it is a spend *bound*, not a security control, and the
 * access code is what actually gates entry. A KV or Durable Object counter
 * would make it exact; that is the upgrade if A.I.R. ever goes ungated.
 */

/** Requests allowed per window, per client, per isolate. */
export const RATE_LIMIT = 8;

/** Window length in milliseconds. */
export const RATE_WINDOW_MS = 60_000;

/**
 * Compare two strings without leaking their common prefix through timing.
 *
 * A plain `===` on a secret returns as soon as it finds a differing byte, so
 * response time reveals how much of a guess was right. This costs nothing and
 * removes the question.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function safeEqual(a, b) {
  const left = String(a ?? '');
  const right = String(b ?? '');

  // Comparing across the longer length keeps the loop count independent of
  // which input is shorter; the length check still gates the result.
  const length = Math.max(left.length, right.length);
  let diff = left.length === right.length ? 0 : 1;

  for (let i = 0; i < length; i++) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }

  return diff === 0;
}

/**
 * Whether a supplied code opens the gate.
 *
 * An unset AIR_ACCESS_CODE denies everything rather than allowing everything.
 * A missing secret is the most likely misconfiguration, and the failure it
 * causes should be "nobody can use A.I.R." rather than "the spend cap is off".
 *
 * @param {string | undefined} supplied
 * @param {string | undefined} expected
 * @returns {boolean}
 */
export function isAuthorised(supplied, expected) {
  if (typeof expected !== 'string' || expected.trim() === '') return false;
  return safeEqual(supplied, expected);
}

/**
 * Create a fixed-window rate limiter.
 *
 * @param {{limit?: number, windowMs?: number, now?: () => number}} [options]
 */
export function createRateLimiter(options = {}) {
  const {
    limit = RATE_LIMIT,
    windowMs = RATE_WINDOW_MS,
    now = () => Date.now(),
  } = options;

  /** @type {Map<string, {count: number, resetAt: number}>} */
  const buckets = new Map();

  return {
    /**
     * @param {string} key Client identifier — the connecting IP.
     * @returns {{allowed: boolean, remaining: number, retryAfterSeconds: number}}
     */
    check(key) {
      const time = now();
      const bucket = buckets.get(key);

      if (!bucket || time >= bucket.resetAt) {
        buckets.set(key, { count: 1, resetAt: time + windowMs });

        // Drop windows that have expired. Without this the map grows for the
        // lifetime of the isolate, which is a slow leak under crawler traffic.
        for (const [otherKey, otherBucket] of buckets) {
          if (time >= otherBucket.resetAt) buckets.delete(otherKey);
        }

        return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
      }

      if (bucket.count >= limit) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.ceil((bucket.resetAt - time) / 1000),
        };
      }

      bucket.count += 1;
      return { allowed: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
    },
  };
}
