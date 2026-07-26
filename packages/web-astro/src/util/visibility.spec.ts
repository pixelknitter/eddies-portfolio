import { describe, it, expect } from 'vitest';
import { showUnpublished, showAIR, showHighlights } from './visibility.mjs';

describe('showUnpublished', () => {
  it('is true in local dev', () => {
    expect(showUnpublished({ DEV: true })).toBe(true);
  });

  it('is true when the flag is set, even in a production build', () => {
    expect(showUnpublished({ DEV: false, PUBLIC_SHOW_UNPUBLISHED: 'true' })).toBe(true);
  });

  it('is false in a production build with no flag', () => {
    expect(showUnpublished({ DEV: false })).toBe(false);
    expect(showUnpublished({})).toBe(false);
  });

  it('only accepts the exact string "true"', () => {
    // Env vars arrive as strings; anything truthy-but-not-"true" must not
    // accidentally expose drafts on production.
    for (const value of ['false', '1', 'yes', 'TRUE', '', undefined]) {
      expect(showUnpublished({ PUBLIC_SHOW_UNPUBLISHED: value }), String(value)).toBe(false);
    }
  });
});

describe('showAIR', () => {
  it('is off unless explicitly enabled', () => {
    expect(showAIR({})).toBe(false);
    expect(showAIR({ PUBLIC_SHOW_AIR: 'false' })).toBe(false);
  });

  it('is on when the flag is exactly "true"', () => {
    expect(showAIR({ PUBLIC_SHOW_AIR: 'true' })).toBe(true);
  });
});

describe('showHighlights', () => {
  it('is off unless explicitly enabled', () => {
    expect(showHighlights({})).toBe(false);
    expect(showHighlights({ PUBLIC_SHOW_HIGHLIGHTS: 'false' })).toBe(false);
  });

  it('is on for the exact string "true"', () => {
    expect(showHighlights({ PUBLIC_SHOW_HIGHLIGHTS: 'true' })).toBe(true);
  });

  // Unlike showUnpublished, dev does not imply on: the section is hidden
  // because the stories are not written yet, which is true everywhere.
  it('is not implied by dev mode', () => {
    expect(showHighlights({ DEV: true })).toBe(false);
  });
});
