import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readRuntimeFlags, resetFlagCache } from './client.mjs';
import {
  applyOverrides,
  buildTimeSections,
  KILL_FLAGS,
  resolveSections,
  SECTION_FLAGS,
} from './sections.mjs';

const KEY = { PUBLIC_POSTHOG_KEY: 'phc_test' };

/**
 * A `/flags?v=2` body in the shape the live endpoint actually returns.
 *
 * Kept faithful on purpose. An earlier version of this helper mirrored the v1
 * `featureFlags` map from the docs, which made every test pass against a client
 * that could never work in production.
 */
function flagsResponse(enabledByKey: Record<string, boolean>) {
  return {
    ok: true,
    json: async () => ({
      errorsWhileComputingFlags: false,
      flags: Object.fromEntries(
        Object.entries(enabledByKey).map(([key, enabled]) => [
          key,
          {
            key,
            enabled,
            variant: null,
            reason: { code: enabled ? 'condition_match' : 'out_of_rollout_bound' },
            metadata: { id: 1, payload: null },
          },
        ]),
      ),
    }),
  };
}

describe('applyOverrides — content sections', () => {
  it('turns a content section on when the build did not', () => {
    const base = buildTimeSections({});
    expect(base.blog).toBe(false);

    const resolved = applyOverrides(base, { [SECTION_FLAGS.blog]: true });
    expect(resolved.blog).toBe(true);
  });

  it('turns a content section off when the build turned it on', () => {
    const base = buildTimeSections({ PUBLIC_SHOW_BLOG: 'true' });
    expect(base.blog).toBe(true);

    const resolved = applyOverrides(base, { [SECTION_FLAGS.blog]: false });
    expect(resolved.blog).toBe(false);
  });

  it('leaves the compiled value alone when a flag is absent', () => {
    const base = buildTimeSections({ PUBLIC_SHOW_BLOG: 'true' });
    expect(applyOverrides(base, {}).blog).toBe(true);
  });

  it('ignores non-boolean flag values rather than coercing them', () => {
    // A multivariate flag returns a string. Coercing would silently flip a
    // section on for a value that meant something else entirely.
    const base = buildTimeSections({});
    for (const value of ['control', '', 0, null, undefined]) {
      const resolved = applyOverrides(base, { [SECTION_FLAGS.blog]: value });
      expect(resolved.blog).toBe(false);
    }
  });
});

describe('applyOverrides — gated features may only be killed', () => {
  it('REFUSES to enable A.I.R. that the build disabled', () => {
    // The load-bearing assertion of the whole two-layer design. If this ever
    // passes as `true`, production can serve a model-spending endpoint because a
    // third-party service said so.
    const base = buildTimeSections({});
    expect(base.air).toBe(false);

    const resolved = applyOverrides(base, {
      'section-air': true,
      [KILL_FLAGS.air]: false,
    });
    expect(resolved.air).toBe(false);
  });

  it('REFUSES to enable the resume that the build disabled', () => {
    const base = buildTimeSections({});
    const resolved = applyOverrides(base, {
      'section-resume': true,
      [KILL_FLAGS.resume]: false,
    });
    expect(resolved.resume).toBe(false);
  });

  it('allows A.I.R. to be killed at runtime', () => {
    const base = buildTimeSections({ PUBLIC_SHOW_AIR: 'true' });
    expect(base.air).toBe(true);

    const resolved = applyOverrides(base, { [KILL_FLAGS.air]: true });
    expect(resolved.air).toBe(false);
  });

  it('allows the resume to be killed at runtime', () => {
    const base = buildTimeSections({ PUBLIC_SHOW_RESUME: 'true' });
    const resolved = applyOverrides(base, { [KILL_FLAGS.resume]: true });
    expect(resolved.resume).toBe(false);
  });

  it('leaves a section alone when its kill switch is off', () => {
    // An inactive kill switch is omitted by PostHog entirely; an active one at
    // zero rollout arrives as `false`. Neither may take a section down.
    const base = buildTimeSections({ PUBLIC_SHOW_AIR: 'true' });
    expect(applyOverrides(base, { [KILL_FLAGS.air]: false }).air).toBe(true);
    expect(applyOverrides(base, {}).air).toBe(true);
  });
});

describe('applyOverrides — build-time-only sections', () => {
  it('ignores a runtime flag for projects, which is prerendered', () => {
    const base = buildTimeSections({});
    const resolved = applyOverrides(base, { 'section-projects': true });
    expect(resolved.projects).toBe(false);
  });

  it('ignores a runtime flag for the print routes, which leak contact details', () => {
    const base = buildTimeSections({});
    const resolved = applyOverrides(base, { 'section-resume-print': true });
    expect(resolved.resumePrint).toBe(false);
  });
});

describe('collectsData — what gates the privacy policy', () => {
  it('is false when nothing collects anything', () => {
    expect(applyOverrides(buildTimeSections({}), null).collectsData).toBe(false);
  });

  it('is true when A.I.R. is on', () => {
    const base = buildTimeSections({ PUBLIC_SHOW_AIR: 'true' });
    expect(applyOverrides(base, null).collectsData).toBe(true);
  });

  it('is true when the resume gate is on', () => {
    const base = buildTimeSections({ PUBLIC_SHOW_RESUME: 'true' });
    expect(applyOverrides(base, null).collectsData).toBe(true);
  });

  it('is true when analytics has a key, even with every section off', () => {
    const base = buildTimeSections(KEY);
    expect(base.air).toBe(false);
    expect(applyOverrides(base, null).collectsData).toBe(true);
  });

  it('follows a runtime kill — killing A.I.R. with no analytics stops collection', () => {
    const base = buildTimeSections({ PUBLIC_SHOW_AIR: 'true' });
    const resolved = applyOverrides(base, { [KILL_FLAGS.air]: true });
    expect(resolved.collectsData).toBe(false);
  });
});

describe('readRuntimeFlags', () => {
  beforeEach(() => resetFlagCache());

  it('has no opinion when there is no key', async () => {
    const fetchImpl = vi.fn();
    expect(await readRuntimeFlags({}, { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches once per TTL rather than once per request', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(flagsResponse({ [SECTION_FLAGS.blog]: true }));

    await readRuntimeFlags(KEY, { fetchImpl, now: 1_000 });
    await readRuntimeFlags(KEY, { fetchImpl, now: 2_000 });
    await readRuntimeFlags(KEY, { fetchImpl, now: 3_000 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('re-fetches once the TTL has passed', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(flagsResponse({ [SECTION_FLAGS.blog]: true }));

    await readRuntimeFlags(KEY, { fetchImpl, now: 1_000 });
    await readRuntimeFlags(KEY, { fetchImpl, now: 1_000 + 30_001 });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('posts the project token and a stable distinct id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(flagsResponse({}));
    await readRuntimeFlags(KEY, { fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://us.i.posthog.com/flags?v=2');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.api_key).toBe('phc_test');
    expect(typeof body.distinct_id).toBe('string');
  });

  it('has no opinion when the request throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await readRuntimeFlags(KEY, { fetchImpl })).toBeNull();
  });

  it('has no opinion on a non-ok response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await readRuntimeFlags(KEY, { fetchImpl })).toBeNull();
  });

  it('has no opinion when the body carries no flag map', async () => {
    // Treating a malformed body as an empty one would disable every content
    // section at once, which is the loudest possible way to get this wrong.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ oops: true }) });
    expect(await readRuntimeFlags(KEY, { fetchImpl })).toBeNull();
  });

  it('does not read the legacy v1 `featureFlags` map', async () => {
    /*
     * The regression this guards is a silent one. `?v=2` returns `flags` and
     * leaves `featureFlags` as null, so a client reading the v1 key gets null on
     * every call, reports "no opinion", and applies no override ever — with no
     * error, no warning, and flags that simply appear not to work.
     */
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        featureFlags: { 'section-blog': true },
        flags: null,
      }),
    });
    expect(await readRuntimeFlags(KEY, { fetchImpl })).toBeNull();
  });

  it('reads `enabled` out of the v2 flag objects', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      flagsResponse({ 'section-blog': true, 'section-air-kill': false }),
    );
    expect(await readRuntimeFlags(KEY, { fetchImpl })).toEqual({
      'section-blog': true,
      'section-air-kill': false,
    });
  });

  it('treats an empty flag map as empty, not as an error', async () => {
    // Every flag inactive is the normal resting state, and PostHog expresses it
    // as `flags: {}`. That must mean "no overrides", not "call failed".
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ flags: {} }) });
    expect(await readRuntimeFlags(KEY, { fetchImpl })).toEqual({});
  });

  it('shares one fetch across concurrent callers', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(flagsResponse({ [SECTION_FLAGS.blog]: true }));

    await Promise.all([
      readRuntimeFlags(KEY, { fetchImpl }),
      readRuntimeFlags(KEY, { fetchImpl }),
      readRuntimeFlags(KEY, { fetchImpl }),
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('resolveSections', () => {
  beforeEach(() => resetFlagCache());

  it('falls back to the compiled values when PostHog is unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    const sections = await resolveSections(
      { ...KEY, PUBLIC_SHOW_BLOG: 'true' },
      { fetchImpl },
    );
    expect(sections.blog).toBe(true);
  });

  it('applies a runtime override end to end', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(flagsResponse({ [SECTION_FLAGS.blog]: true }));
    const sections = await resolveSections(KEY, { fetchImpl });
    expect(sections.blog).toBe(true);
  });

  it('returns a frozen object, so a caller cannot flip a gate downstream', async () => {
    const sections = await resolveSections({});
    expect(Object.isFrozen(sections)).toBe(true);
  });
});
