import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getClient, loadClient, resetClientForTests } from './client.mjs';

/**
 * The site's side of the telemetry client.
 *
 * `@pk/telemetry` owns the interface and the adapter; this owns *loading* — the
 * dynamic import, the single-flight guard, and the promise that a failure here
 * costs a page nothing.
 */

beforeEach(() => {
  resetClientForTests();
});

describe('before anything is loaded', () => {
  it('hands back a client that accepts every call', () => {
    // The reason this is a no-op rather than null: call sites should not have
    // to guard, because a guard that is forgotten is a crash on a page whose
    // job is to impress someone.
    const client = getClient();

    expect(client.active).toBe(false);
    expect(() => client.capture('anything')).not.toThrow();
  });
});

describe('loadClient', () => {
  it('installs the loaded client and reports it active', async () => {
    const init = vi.fn();
    const client = await loadClient(
      { token: 'phc_test' },
      async () => ({
        createPostHogClient: () => ({ ...stub(), init, active: true }),
        posthog: {},
      }),
    );

    expect(init).toHaveBeenCalledWith({ token: 'phc_test' });
    expect(client.active).toBe(true);
    expect(getClient().active).toBe(true);
  });

  it('loads once even when called repeatedly', async () => {
    // Bound to astro:page-load, so this fires on every navigation. Loading the
    // SDK again per page would be a bug nobody would see except in a waterfall.
    const load = vi.fn(async () => ({
      createPostHogClient: () => ({ ...stub(), active: true }),
      posthog: {},
    }));

    await loadClient({ token: 'phc_test' }, load);
    await loadClient({ token: 'phc_test' }, load);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('falls back to the no-op when the import fails', async () => {
    // A blocked script, an ad-blocker, an offline visitor. Telemetry failing
    // must never be why a page breaks.
    const client = await loadClient({ token: 'phc_test' }, async () => {
      throw new Error('blocked');
    });

    expect(client.active).toBe(false);
    expect(() => client.capture('anything')).not.toThrow();
  });

  it('falls back to the no-op when init throws', async () => {
    const client = await loadClient({ token: 'phc_test' }, async () => ({
      createPostHogClient: () => ({
        ...stub(),
        init() {
          throw new Error('bad token');
        },
      }),
      posthog: {},
    }));

    expect(client.active).toBe(false);
  });
});

/** A client shaped like the interface, doing nothing. */
function stub() {
  return {
    active: false,
    init() {},
    pageview() {},
    capture() {},
    surveyShown() {},
    surveySent() {},
  };
}
