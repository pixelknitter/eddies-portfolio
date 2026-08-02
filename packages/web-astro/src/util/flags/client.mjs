/**
 * Reads runtime feature flags from PostHog.
 *
 * ## Why not the SDK's local evaluation
 *
 * PostHog names this runtime as an anti-pattern outright: local evaluation with
 * the default in-memory cache "causes performance issues and inflated costs due
 * to per-request initialization" in edge and lambda environments, and their
 * documented answer for Cloudflare is a KV-backed external cache provider. It
 * also needs a *feature flags secure API key*, which would be a new Worker secret
 * to seed on three tiers.
 *
 * None of that machinery is needed here, because these flags have no targeting —
 * a section is on or off for everyone. So this calls the public `/flags` endpoint
 * with the project token (public and write-only, already in the client bundle) and
 * caches the answer in module scope. One fetch per isolate per TTL, not one per
 * request.
 *
 * That is the same shape as the per-isolate rate limiter in `air/access.mjs`, with
 * the same caveat: the cache lives and dies with the isolate, so a toggle takes up
 * to TTL plus however long Cloudflare keeps the isolate warm to reach everyone.
 * Best-effort by construction, which is the right trade for a visibility switch
 * and the wrong one for a security boundary — see `sections.mjs` for how that line
 * is drawn.
 *
 * ## Failure is always "no opinion"
 *
 * Every failure path returns the last known value, or `null` if there has never
 * been one. `null` means "PostHog said nothing", and the caller falls back to the
 * compiled build-time value. A network blip must never change what the site
 * serves.
 */

const DEFAULT_HOST = 'https://us.i.posthog.com';

/** How long a fetched answer is trusted. Short, because the point is toggling. */
const TTL_MS = 30_000;

/** Bounded so a slow PostHog cannot become slow page renders. */
const TIMEOUT_MS = 1_500;

/**
 * These flags are not per-visitor, so the id only has to be stable — it exists
 * because `/flags` requires one. A constant also means a percentage rollout on one
 * of these flags resolves all-or-nothing, which is the correct behaviour for a
 * section toggle and worth knowing before someone sets one to 50%.
 */
const DISTINCT_ID = 'eddie-engineering-server';

/**
 * Both projections of one answer.
 *
 * `flags` is key to `enabled`, which is what a section toggle needs. `variants`
 * is key to the string PostHog returns for a multivariate flag, which is what
 * `air-model` needs — and which the boolean projection necessarily throws away.
 * One fetch feeds both, because two callers wanting different slices of the
 * same response is not a reason to ask twice.
 *
 * @type {{ at: number, flags: Record<string, unknown> | null, variants: Record<string, unknown> | null }}
 */
let cache = { at: 0, flags: null, variants: null };

/** Shared so a burst of concurrent requests makes one fetch, not one each. */
/** @type {Promise<{flags: Record<string, unknown> | null, variants: Record<string, unknown> | null}> | null} */
let inFlight = null;

/** Test seam. Module state outlives a single test otherwise. */
export function resetFlagCache() {
  cache = { at: 0, flags: null, variants: null };
  inFlight = null;
}

/**
 * @param {Record<string, unknown> | undefined} env
 * @param {{ now?: number, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<Record<string, unknown> | null>} Flag map, or `null` for
 *   "no runtime opinion" — unconfigured, unreachable, or malformed.
 */
export async function readRuntimeFlags(env, options = {}) {
  return (await read(env, options)).flags;
}

/**
 * The variant each flag resolved to, for the flags that carry one.
 *
 * Shares the fetch and the cache with `readRuntimeFlags`. A flag with no
 * variant is `null` here and still `true`/`false` there.
 *
 * @param {Record<string, unknown> | undefined} env
 * @param {{ now?: number, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function readRuntimeVariants(env, options = {}) {
  return (await read(env, options)).variants;
}

/**
 * @param {Record<string, unknown> | undefined} env
 * @param {{ now?: number, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<{flags: Record<string, unknown> | null, variants: Record<string, unknown> | null}>}
 */
async function read(env, options = {}) {
  const key = env?.PUBLIC_POSTHOG_KEY;
  // Unconfigured is a normal state, not an error: `astro dev`, vitest, and any
  // preview whose key was not set all land here.
  if (!key) return { flags: null, variants: null };

  const now = options.now ?? Date.now();
  if (cache.flags && now - cache.at < TTL_MS) {
    return { flags: cache.flags, variants: cache.variants };
  }
  if (inFlight) return inFlight;

  const host = env?.PUBLIC_POSTHOG_HOST || DEFAULT_HOST;
  const doFetch = options.fetchImpl ?? fetch;

  inFlight = (async () => {
    try {
      const response = await doFetch(`${host}/flags?v=2`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: key, distinct_id: DISTINCT_ID }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) return { flags: cache.flags, variants: cache.variants };

      const body = await response.json();
      /*
       * `?v=2` answers with `flags`, a map of key to a rich object:
       *
       *   "flags": { "section-blog": { "enabled": true, "variant": null,
       *              "reason": {...}, "metadata": { "payload": null } } }
       *
       * Not `featureFlags`. That is the v1 shape, and on a v2 response it is
       * `null` — which reads as "no flags" rather than as an error, so a client
       * that looks there silently never applies an override and never says why.
       * Verified against the live endpoint; the tutorial still shows v1.
       */
      const entries = body?.flags;
      // A body with no flag map is a malformed answer, not an empty one. An
      // empty map is legitimate and means every flag is inactive.
      if (!entries || typeof entries !== 'object') {
        return { flags: cache.flags, variants: cache.variants };
      }

      const flags = Object.fromEntries(
        Object.entries(entries).map(([key, entry]) => [key, entry?.enabled]),
      );
      const variants = Object.fromEntries(
        Object.entries(entries).map(([key, entry]) => [key, entry?.variant]),
      );

      cache = { at: now, flags, variants };
      return { flags, variants };
    } catch {
      // Timeout, network error, invalid JSON. Keep serving what we had.
      return { flags: cache.flags, variants: cache.variants };
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
