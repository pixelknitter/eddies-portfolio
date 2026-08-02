import { redact } from './redact.mjs';

/**
 * Batched, fire-and-forget delivery to PostHog.
 *
 * ## Why plain HTTP and not `posthog-node`
 *
 * Capture works over `POST /batch/` authenticated with the project token, which
 * is write-only and designed to ship to browsers. That buys three things the SDK
 * would cost:
 *
 * - **No new dependency in the Worker bundle**, which matters against the 3 MB
 *   Workers Free ceiling the resume PDFs are already eating into.
 * - **No per-request SDK initialisation** — precisely the edge-runtime
 *   anti-pattern PostHog documents for local flag evaluation, and the same
 *   reasoning that shaped `flags/client.mjs`.
 * - **No new secret.** `PUBLIC_POSTHOG_KEY` is a build-time public value, so
 *   there is nothing to `wrangler secret put` and nothing to add to the preview
 *   seeding block.
 *
 * ## The four guarantees
 *
 * 1. **No-op when unconfigured.** No key, no queue, no fetch. `astro dev`,
 *    vitest and an unseeded preview all land here, and none of them is an error.
 * 2. **Never blocks a response.** The send is handed to `ctx.waitUntil()`, so
 *    the visitor's answer is never waiting on PostHog.
 * 3. **Never throws.** Every path is wrapped and swallowed with a `console.error`
 *    breadcrumb. A telemetry failure must not turn a working answer into a 502.
 * 4. **One outbound request.** A trace, its retrieval span and its generation
 *    travel together rather than as three fetches.
 *
 * Note which budget each of those spends. Workers Free caps **CPU** time (~10 ms),
 * not wall-clock. Serialising a payload is CPU and is small; the outbound fetch
 * is wall time and happens after the response. Conflating the two leads to
 * optimising the wrong one.
 */

const DEFAULT_HOST = 'https://us.i.posthog.com';

/** Bounded so a slow PostHog cannot hold a `waitUntil` open indefinitely. */
const TIMEOUT_MS = 3_000;

/**
 * @typedef {object} TelemetryEvent
 * @property {string} event
 * @property {Record<string, unknown>} properties
 */

/**
 * @param {Record<string, unknown> | undefined} env
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   waitUntil?: (promise: Promise<unknown>) => void,
 *   distinctId?: string,
 * }} [options]
 */
export function createTransport(env, options = {}) {
  const key = env?.PUBLIC_POSTHOG_KEY;
  const host = env?.PUBLIC_POSTHOG_HOST || DEFAULT_HOST;
  const doFetch = options.fetchImpl ?? fetch;

  /**
   * These events are not per-visitor, so the id only has to be stable — it
   * exists because the ingest API requires one. Anonymous by construction: see
   * the identity note in docs/observability/03-design.md for why no `identify`
   * call is made and no person profile is created.
   */
  const distinctId = options.distinctId ?? 'eddie-engineering-server';

  /** @type {TelemetryEvent[]} */
  let queue = [];

  return {
    /** @param {TelemetryEvent} event */
    enqueue(event) {
      // Dropping on the floor when unconfigured keeps every caller free of
      // `if (configured)` noise.
      if (!key) return;
      queue.push(event);
    },

    async flush() {
      if (!key || queue.length === 0) return;

      // Taken before the await so a concurrent enqueue cannot be sent twice,
      // and so a failed send cannot be retried into a duplicate.
      const batch = queue;
      queue = [];

      const body = JSON.stringify(
        redact({
          api_key: key,
          batch: batch.map((item) => ({
            event: item.event,
            properties: {
              distinct_id: distinctId,
              // Anonymous events are ~5× cheaper than identified ones, and
              // there is no cross-session behaviour here worth the exposure.
              $process_person_profile: false,
              ...item.properties,
            },
          })),
        }),
      );

      const send = (async () => {
        try {
          const response = await doFetch(`${host}/batch/`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          if (!response.ok) {
            // A 401 here almost always means a scrubbing rule ate the project
            // key — see PROJECT_KEY_SAFE_KEYS in redact.mjs.
            console.error(`[telemetry] ingest responded ${response.status}`);
          }
        } catch (error) {
          console.error('[telemetry] ingest failed', error);
        }
      })();

      if (options.waitUntil) {
        options.waitUntil(send);
        return;
      }

      // No waitUntil (tests, local dev): await it, because otherwise the
      // process may exit before the request is made and the failure would look
      // like "capture is broken".
      await send;
    },
  };
}
