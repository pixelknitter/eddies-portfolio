/**
 * Loads the browser telemetry client, and holds a stable handle to it.
 *
 * ## Why the SDK is dynamic-imported
 *
 * So it is absent from the bundle of every route that does not need it. Whether
 * a route loads it at all is decided server-side by `analyticsSiteWide` in
 * `flags/sections.mjs`, before a byte ships — this module only handles the
 * loading once that decision is made.
 *
 * ## Why calls are buffered rather than dropped
 *
 * `getClient()` used to hand back a no-op until the SDK finished loading, so
 * anything emitted in between vanished. That was worst in the *default*
 * feedback-only mode, where nothing loads the SDK until an island asks for it:
 * the first survey impression of every session was lost, silently, with no
 * error to notice.
 *
 * So this returns one stable façade whose calls queue until a real client
 * arrives, then replay in order. Buffering rather than a subscription because
 * it fixes every caller — the Layout pageview, the resume funnel, and React
 * alike — where a store would only have helped the components.
 *
 * The queue is bounded. A page where the SDK never loads must not accumulate
 * events for as long as the tab is open.
 *
 * ## Why every failure lands on silence
 *
 * A blocked script, an ad-blocker, an offline visitor, a bad token. Telemetry
 * must never be why a page breaks, so nothing here rejects and nothing throws —
 * which is the promise `createTransport` already makes in the Worker.
 */

/** Beyond this, the oldest queued call is discarded. */
const MAX_QUEUED = 50;

/** @type {import('@pk/telemetry/client').TelemetryClient | null} */
let live = null;

/** @type {Promise<import('@pk/telemetry/client').TelemetryClient> | null} */
let loading = null;

/** @type {Array<[string, unknown[]]>} */
let queued = [];

/**
 * Forward to the live client, or hold the call until there is one.
 *
 * @param {string} method
 * @param {unknown[]} args
 */
function forward(method, args) {
  if (live?.active) {
    // @ts-expect-error indexed access on a known-shaped interface
    live[method](...args);
    return;
  }

  queued.push([method, args]);
  if (queued.length > MAX_QUEUED) queued.shift();
}

/**
 * One handle, stable for the life of the page.
 *
 * Callers never need to guard on readiness, which is the point: a guard that is
 * forgotten is a lost event at best and a crash at worst, on a page whose job is
 * to impress someone.
 *
 * @type {import('@pk/telemetry/client').TelemetryClient}
 */
const facade = {
  get active() {
    return Boolean(live?.active);
  },
  init: (...args) => forward('init', args),
  pageview: (...args) => forward('pageview', args),
  capture: (...args) => forward('capture', args),
  surveyShown: (...args) => forward('surveyShown', args),
  surveySent: (...args) => forward('surveySent', args),
};

/** @returns {import('@pk/telemetry/client').TelemetryClient} */
export function getClient() {
  return facade;
}

/**
 * The default loader. Separated so tests inject one and never touch the real
 * SDK, and so both imports are visible in one place.
 *
 * @returns {Promise<{createPostHogClient: Function, posthog: unknown}>}
 */
async function importSdk() {
  const [posthogModule, adapterModule] = await Promise.all([
    import('posthog-js'),
    import('@pk/telemetry/posthog'),
  ]);

  return {
    posthog: posthogModule.default ?? posthogModule,
    createPostHogClient: adapterModule.createPostHogClient,
  };
}

/**
 * Load and initialise the real client, at most once, then replay anything that
 * was queued while waiting.
 *
 * Single-flight: this is bound to `astro:page-load` and called by islands, so
 * it fires repeatedly. Re-importing the SDK each time would be a bug visible
 * only in a network waterfall.
 *
 * @param {{token: string, host?: string}} config
 * @param {() => Promise<{createPostHogClient: Function, posthog: unknown}>} [load]
 * @returns {Promise<import('@pk/telemetry/client').TelemetryClient>}
 */
export function loadClient(config, load = importSdk) {
  if (live?.active) return Promise.resolve(facade);
  if (loading) return loading;

  loading = load()
    .then(({ createPostHogClient, posthog }) => {
      const client = createPostHogClient(posthog);
      client.init(config);
      live = client;

      const replay = queued;
      queued = [];
      for (const [method, args] of replay) forward(method, args);

      return facade;
    })
    .catch(() => {
      // Deliberately swallowed, and deliberately not logged: a visitor's
      // console is not the place to report that analytics could not start, and
      // the absence of events is itself the signal on the receiving end.
      //
      // The queue is dropped rather than kept — a retry is not coming, and
      // holding events for a client that will never arrive is a leak.
      queued = [];
      return facade;
    });

  return loading;
}

/**
 * Load using the configuration the layout published, if analytics is on at all.
 *
 * This is what islands call. In feedback-only mode the layout does not
 * auto-load, so the surface that actually needs telemetry is the one that
 * triggers it — and if analytics is off entirely there is no config and this
 * resolves to the façade unchanged.
 *
 * @returns {Promise<import('@pk/telemetry/client').TelemetryClient>}
 */
export function ensureClient() {
  const config = /** @type {{token?: string, host?: string} | undefined} */ (
    /** @type {Record<string, unknown>} */ (globalThis).__PK_TELEMETRY__
  );

  if (!config?.token) return Promise.resolve(facade);
  return loadClient({ token: config.token, host: config.host });
}

/** @internal How many calls are waiting for a client. */
export function queuedForTests() {
  return queued.length;
}

/** @internal Resets module state between tests. */
export function resetClientForTests() {
  live = null;
  loading = null;
  queued = [];
}
