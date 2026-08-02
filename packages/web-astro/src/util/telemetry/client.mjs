import { createNoopClient } from '@pk/telemetry/client';

/**
 * Loads the browser telemetry client, once per page session.
 *
 * ## Why the SDK is dynamic-imported
 *
 * So it is absent from the bundle of every route that does not need it. Whether
 * *any* route needs it is decided server-side by `analyticsSiteWide` in
 * `flags/sections.mjs`, before a byte ships — this module only handles the
 * loading once that decision has been made.
 *
 * ## Why every failure lands on the no-op
 *
 * A blocked script, an ad-blocker, an offline visitor, a bad token. Telemetry
 * must never be why a page breaks, so nothing here rejects: a failed import or
 * a throwing `init` leaves the no-op in place and the call sites carry on
 * talking to something that accepts every call.
 *
 * That is the same promise `createTransport` makes in the Worker.
 */

/** @type {import('@pk/telemetry/client').TelemetryClient} */
let client = createNoopClient();

/** @type {Promise<import('@pk/telemetry/client').TelemetryClient> | null} */
let loading = null;

/**
 * The current client — the no-op until a real one has loaded.
 *
 * Callers never need to guard on this, which is the point: a guard that is
 * forgotten is a crash on a page whose job is to impress someone.
 *
 * @returns {import('@pk/telemetry/client').TelemetryClient}
 */
export function getClient() {
  return client;
}

/**
 * The default loader. Separated so tests can inject one and never touch the
 * real SDK, and so the two imports are visible in one place.
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
 * Load and initialise the real client, at most once.
 *
 * Single-flight: this is bound to `astro:page-load`, so it fires on every
 * navigation, and re-importing the SDK per page would be a bug visible only in
 * a network waterfall.
 *
 * @param {{token: string, host?: string}} config
 * @param {() => Promise<{createPostHogClient: Function, posthog: unknown}>} [load]
 * @returns {Promise<import('@pk/telemetry/client').TelemetryClient>}
 */
export function loadClient(config, load = importSdk) {
  if (client.active) return Promise.resolve(client);
  if (loading) return loading;

  loading = load()
    .then(({ createPostHogClient, posthog }) => {
      const live = createPostHogClient(posthog);
      live.init(config);
      client = live;
      return client;
    })
    .catch(() => {
      // Deliberately swallowed, and deliberately not logged: a visitor's
      // console is not the place to report that analytics could not start, and
      // the absence of events is itself the signal on the receiving end.
      return client;
    });

  return loading;
}

/** @internal Resets module state between tests. */
export function resetClientForTests() {
  client = createNoopClient();
  loading = null;
}
