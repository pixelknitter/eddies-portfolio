import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

/*
 * jsdom implements no `matchMedia`, and anything that reads a motion or theme
 * preference calls it — `useReducedMotion` does, so every component that
 * renders a Modal did too, and they all failed on "matchMedia is not a
 * function" rather than on anything they were testing.
 *
 * The default answers "no preference", which is the state most specs want.
 * A spec that cares overrides `window.matchMedia` in its own `beforeEach`,
 * which runs after this one — see SeedQuestions.spec.tsx, which drives both
 * sides of the reduced-motion rule.
 *
 * Reassigned before *every* test rather than once behind an `if (!…)` guard.
 * `window` is shared across the files in a worker, so a spec that installs its
 * own mock and then calls `restoreAllMocks` leaves the property assigned but
 * gutted — it returns `undefined`, and the next file to read `.matches` on it
 * fails with an error naming neither the spec that broke it nor the one that
 * tripped over it.
 */
beforeEach(() => {
  if (typeof window === 'undefined') return;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

// Ensure the DOM is reset between component tests.
afterEach(() => {
  cleanup();
});
