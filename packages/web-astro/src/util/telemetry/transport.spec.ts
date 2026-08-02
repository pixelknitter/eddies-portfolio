import { describe, it, expect, vi } from 'vitest';

import { createTransport } from './transport.mjs';

/**
 * The four properties the seam must have. Each is a guarantee that telemetry
 * cannot make a working answer worse, and each has a test here because the
 * failure mode of every one of them is silent.
 */

const KEY = { PUBLIC_POSTHOG_KEY: 'phc_test' };

/** A fetch that records calls and resolves 200. */
function stubFetch() {
  return vi.fn(async () => new Response('{}', { status: 200 }));
}

/**
 * One recorded call, typed. The stub takes no parameters so it stays assignable
 * to `typeof fetch`, which leaves vitest inferring an empty argument tuple —
 * hence the cast rather than a narrower stub signature.
 */
function callOf(fetchImpl: ReturnType<typeof stubFetch>, call = 0) {
  return fetchImpl.mock.calls[call] as unknown as [string, { body: string }];
}

/** The serialised body of one recorded call. */
function bodyOf(fetchImpl: ReturnType<typeof stubFetch>, call = 0): string {
  return callOf(fetchImpl, call)[1].body;
}

describe('createTransport', () => {
  it('no-ops when there is no project key', async () => {
    // Unconfigured is a normal state, not an error: astro dev, vitest, and any
    // preview whose key was not seeded all land here.
    const fetchImpl = stubFetch();
    const transport = createTransport({}, { fetchImpl });

    transport.enqueue({ event: 'air_test', properties: {} });
    await transport.flush();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends one batched request rather than one per event', async () => {
    const fetchImpl = stubFetch();
    const transport = createTransport(KEY, { fetchImpl });

    transport.enqueue({ event: '$ai_trace', properties: {} });
    transport.enqueue({ event: '$ai_span', properties: {} });
    transport.enqueue({ event: '$ai_generation', properties: {} });
    await transport.flush();

    // A trace, its retrieval span and its generation travel together. Three
    // fetches would be three chances to add latency and three to fail.
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    expect(callOf(fetchImpl)[0]).toBe('https://us.i.posthog.com/batch/');
    expect(JSON.parse(bodyOf(fetchImpl)).batch).toHaveLength(3);
  });

  it('authenticates with the project key, which is write-only and safe to expose', async () => {
    const fetchImpl = stubFetch();
    const transport = createTransport(KEY, { fetchImpl });

    transport.enqueue({ event: 'air_test', properties: {} });
    await transport.flush();

    expect(JSON.parse(bodyOf(fetchImpl)).api_key).toBe('phc_test');
  });

  it('honours a custom ingest host, for a first-party reverse proxy', async () => {
    const fetchImpl = stubFetch();
    const transport = createTransport(
      { ...KEY, PUBLIC_POSTHOG_HOST: 'https://t.eddie.engineering' },
      { fetchImpl },
    );

    transport.enqueue({ event: 'air_test', properties: {} });
    await transport.flush();

    expect(callOf(fetchImpl)[0]).toBe('https://t.eddie.engineering/batch/');
  });

  it('redacts every payload on the way out', async () => {
    const fetchImpl = stubFetch();
    const transport = createTransport(KEY, { fetchImpl });

    transport.enqueue({
      event: '$ai_generation',
      properties: { comment: 'reach me at eddie@example.com' },
    });
    await transport.flush();

    const body = bodyOf(fetchImpl);
    expect(body).not.toMatch(/[\w.-]+@[\w.-]+\.\w{2,}/);
    // The project key rides in the same payload and must survive it.
    expect(JSON.parse(body).api_key).toBe('phc_test');
  });

  it('never throws when the network fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const transport = createTransport(KEY, { fetchImpl });

    transport.enqueue({ event: 'air_test', properties: {} });

    // A telemetry failure must not convert a working answer into a 502.
    await expect(transport.flush()).resolves.toBeUndefined();
  });

  it('never throws when PostHog answers with an error status', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
    const transport = createTransport(KEY, { fetchImpl });

    transport.enqueue({ event: 'air_test', properties: {} });

    await expect(transport.flush()).resolves.toBeUndefined();
  });

  it('sends nothing when nothing was enqueued', async () => {
    const fetchImpl = stubFetch();
    const transport = createTransport(KEY, { fetchImpl });

    await transport.flush();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('hands the send to waitUntil so the response is never waiting on it', async () => {
    const fetchImpl = stubFetch();
    const scheduled: Promise<unknown>[] = [];
    const transport = createTransport(KEY, {
      fetchImpl,
      waitUntil: (promise) => scheduled.push(promise),
    });

    transport.enqueue({ event: 'air_test', properties: {} });
    await transport.flush();

    // This is the property that keeps telemetry off the request's critical
    // path. Without it the visitor waits on PostHog.
    expect(scheduled).toHaveLength(1);
    await Promise.all(scheduled);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('empties the queue after a flush, so a retry cannot double-send', async () => {
    const fetchImpl = stubFetch();
    const transport = createTransport(KEY, { fetchImpl });

    transport.enqueue({ event: 'air_test', properties: {} });
    await transport.flush();
    await transport.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
