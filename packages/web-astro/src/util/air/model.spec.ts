import { beforeEach, describe, expect, it } from 'vitest';

import { resetFlagCache } from '../flags/client.mjs';
import { AIR_MODEL_FLAG, DEFAULT_MODEL, resolveModel } from './model.mjs';

/**
 * Which model answers, resolved at request time.
 *
 * Comparing models on real traffic needs the model to change without a deploy —
 * and every failure path has to return the compiled default, on the same
 * principle as `flags/client.mjs`: a network blip must never change what the
 * site serves.
 */

const KEY = { PUBLIC_POSTHOG_KEY: 'phc_test' };

/** A `/flags?v=2` body in the shape the live endpoint returns. */
function flagsBody(value: unknown) {
  return {
    ok: true,
    json: async () => ({
      flags: {
        [AIR_MODEL_FLAG]: { key: AIR_MODEL_FLAG, enabled: true, variant: value },
      },
    }),
  } as unknown as Response;
}

beforeEach(() => {
  resetFlagCache();
});

describe('resolveModel', () => {
  it('falls back to the compiled default with no key configured', async () => {
    expect(await resolveModel({})).toBe(DEFAULT_MODEL);
  });

  it('falls back when PostHog cannot be reached', async () => {
    // A blip must never change which model answers.
    expect(
      await resolveModel(KEY, {
        fetchImpl: async () => {
          throw new Error('down');
        },
      }),
    ).toBe(DEFAULT_MODEL);
  });

  it('uses a string variant when PostHog offers one', async () => {
    expect(
      await resolveModel(KEY, { fetchImpl: async () => flagsBody('claude-sonnet-5') }),
    ).toBe('claude-sonnet-5');
  });

  it('ignores a boolean variant', async () => {
    // `true` means the flag is on, not that the model is named "true". Same
    // discipline as the section flags: only the right type counts.
    expect(
      await resolveModel(KEY, { fetchImpl: async () => flagsBody(true) }),
    ).toBe(DEFAULT_MODEL);
  });

  it('ignores an empty or whitespace variant', async () => {
    expect(
      await resolveModel(KEY, { fetchImpl: async () => flagsBody('   ') }),
    ).toBe(DEFAULT_MODEL);
  });
});
