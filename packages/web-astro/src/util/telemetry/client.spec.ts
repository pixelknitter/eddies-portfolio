import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  getClient,
  loadClient,
  queuedForTests,
  resetClientForTests,
} from './client.mjs';

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

/**
 * A client shaped like the interface, doing nothing.
 *
 * Spread over in each test so only the method under assertion is a spy. The
 * empty bodies are the point, so the rule is silenced rather than satisfied by
 * statements that would suggest these do something.
 */
function stub() {
  /* eslint-disable @typescript-eslint/no-empty-function */
  return {
    active: false,
    init() {},
    pageview() {},
    capture() {},
    surveyShown() {},
    surveySent() {},
  };
  /* eslint-enable @typescript-eslint/no-empty-function */
}

describe('calls made before the client is live', () => {
  /*
   * The bug this exists for: `getClient()` handed back a no-op until the SDK
   * finished loading, so anything emitted in between was dropped silently. In
   * feedback-only mode — the default — nothing loaded the SDK at all until an
   * island asked for it, which meant the first survey impression of every
   * session was lost.
   *
   * Buffering rather than subscribing, because it fixes every caller: the
   * Layout pageview, the resume funnel, and React alike. A store would only
   * have helped the components.
   */

  it('replays queued calls once the client loads', async () => {
    const capture = vi.fn();
    const surveyShown = vi.fn();

    getClient().capture('early_event', { a: 1 });
    getClient().surveyShown('survey-1', 'trace-1');

    await loadClient({ token: 'phc_test' }, async () => ({
      createPostHogClient: () => ({ ...stub(), active: true, capture, surveyShown }),
      posthog: {},
    }));

    expect(capture).toHaveBeenCalledWith('early_event', { a: 1 });
    expect(surveyShown).toHaveBeenCalledWith('survey-1', 'trace-1');
  });

  it('replays in the order they were made', async () => {
    const seen: string[] = [];
    const capture = (event: string) => void seen.push(event);

    getClient().capture('first');
    getClient().capture('second');

    await loadClient({ token: 'phc_test' }, async () => ({
      createPostHogClient: () => ({ ...stub(), active: true, capture }),
      posthog: {},
    }));

    expect(seen).toEqual(['first', 'second']);
  });

  it('drops the queue rather than growing it without bound', () => {
    // A page where the SDK never loads must not accumulate events forever.
    for (let i = 0; i < 500; i += 1) getClient().capture(`event_${i}`);

    expect(queuedForTests()).toBeLessThanOrEqual(50);
  });

  it('discards the queue when loading fails', async () => {
    getClient().capture('early_event');

    await loadClient({ token: 'phc_test' }, async () => {
      throw new Error('blocked');
    });

    expect(queuedForTests()).toBe(0);
  });

  it('sends straight through once live', async () => {
    const capture = vi.fn();
    await loadClient({ token: 'phc_test' }, async () => ({
      createPostHogClient: () => ({ ...stub(), active: true, capture }),
      posthog: {},
    }));

    getClient().capture('later');

    // Forwarded verbatim — one argument in, one argument out. The façade must
    // not invent a properties object, or an event with no properties would
    // arrive shaped differently depending on whether it was queued.
    expect(capture).toHaveBeenCalledWith('later');
    expect(queuedForTests()).toBe(0);
  });
});
