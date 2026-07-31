import { describe, it, expect, vi } from 'vitest';

import { createTelemetry } from './index.mjs';

const KEY = { PUBLIC_POSTHOG_KEY: 'phc_test' };

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

/** Every event in the one batched request this seam sends. */
async function sent(fetchImpl: ReturnType<typeof stubFetch>) {
  return JSON.parse(bodyOf(fetchImpl)).batch;
}

describe('createTelemetry', () => {
  it('captures an event with its properties', async () => {
    const fetchImpl = stubFetch();
    const telemetry = createTelemetry(KEY, { fetchImpl });

    telemetry.capture('resume_download_served', { format: 'full' });
    await telemetry.flush();

    const batch = await sent(fetchImpl);
    expect(batch[0].event).toBe('resume_download_served');
    expect(batch[0].properties.format).toBe('full');
  });

  it('records an error as $exception with its name and status', async () => {
    const fetchImpl = stubFetch();
    const telemetry = createTelemetry(KEY, { fetchImpl });

    const error = Object.assign(new Error('overloaded'), {
      name: 'APIError',
      status: 529,
    });
    telemetry.recordError(error, { outcome: 'upstream_error' });
    await telemetry.flush();

    const batch = await sent(fetchImpl);
    expect(batch[0].event).toBe('$exception');
    // Classifying the SDK error is what makes upstream_error actionable at
    // all: today a 429, a 529, a timeout and a network failure are one
    // indistinguishable 502, and they call for different responses.
    expect(batch[0].properties.error_status).toBe(529);
    expect(batch[0].properties.error_name).toBe('APIError');
  });

  it('records an error that is not an Error object without throwing', async () => {
    const fetchImpl = stubFetch();
    const telemetry = createTelemetry(KEY, { fetchImpl });

    expect(() => telemetry.recordError('a string was thrown', {})).not.toThrow();
    await telemetry.flush();

    expect((await sent(fetchImpl))[0].event).toBe('$exception');
  });

  it('emits a trace, its retrieval span and its generation in one request', async () => {
    const fetchImpl = stubFetch();
    const telemetry = createTelemetry(KEY, { fetchImpl });

    telemetry.captureTrace({
      trace: { traceId: 't-1', outcome: 'answered', questionLength: 10 },
      retrieval: { traceId: 't-1', retrievedIds: ['a'], floorCleared: true },
      generation: {
        traceId: 't-1',
        model: 'claude-opus-5',
        ms: 1000,
        usage: { input_tokens: 5, output_tokens: 1 },
        stopReason: 'end_turn',
      },
    });
    await telemetry.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await sent(fetchImpl)).map((e: { event: string }) => e.event)).toEqual([
      '$ai_trace',
      '$ai_span',
      '$ai_generation',
    ]);
  });

  it('emits a trace and span with no generation when the model was never called', async () => {
    const fetchImpl = stubFetch();
    const telemetry = createTelemetry(KEY, { fetchImpl });

    telemetry.captureTrace({
      trace: { traceId: 't-2', outcome: 'no_context', questionLength: 10 },
      retrieval: { traceId: 't-2', retrievedIds: [], floorCleared: false },
    });
    await telemetry.flush();

    // The no_context path is the one this whole design is careful about: it
    // must be visible as a trace, not absent.
    expect((await sent(fetchImpl)).map((e: { event: string }) => e.event)).toEqual([
      '$ai_trace',
      '$ai_span',
    ]);
  });

  it('emits a trace alone when the request never reached retrieval', async () => {
    const fetchImpl = stubFetch();
    const telemetry = createTelemetry(KEY, { fetchImpl });

    telemetry.captureTrace({
      trace: { traceId: 't-3', outcome: 'rate_limited', questionLength: 0 },
    });
    await telemetry.flush();

    // A span reporting retrieved_count: 0 here would be a lie that looks
    // exactly like no_context — the one signal this design is most careful to
    // keep clean.
    expect((await sent(fetchImpl)).map((e: { event: string }) => e.event)).toEqual([
      '$ai_trace',
    ]);
  });

  it('alert is a no-op stub that does not throw or emit — Wave 2 implements it', async () => {
    const fetchImpl = stubFetch();
    const telemetry = createTelemetry(KEY, { fetchImpl });

    expect(() => telemetry.alert('error', 'upstream failed', {})).not.toThrow();
    await telemetry.flush();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('no-ops entirely when unconfigured', async () => {
    const fetchImpl = stubFetch();
    const telemetry = createTelemetry({}, { fetchImpl });

    telemetry.capture('air_test', {});
    telemetry.recordError(new Error('x'), {});
    await telemetry.flush();

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
