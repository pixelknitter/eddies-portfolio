import { describe, it, expect } from 'vitest';
import {
  showUnpublished,
  showAIR,
  showHighlights,
  showFixtures,
  showResume,
  showResumePrint,
} from './visibility.mjs';

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

describe('showFixtures', () => {
  it('is off unless explicitly enabled', () => {
    expect(showFixtures({})).toBe(false);
    expect(showFixtures({ PUBLIC_SHOW_FIXTURES: 'false' })).toBe(false);
  });

  it('is on for the exact string "true"', () => {
    expect(showFixtures({ PUBLIC_SHOW_FIXTURES: 'true' })).toBe(true);
  });

  // Unlike showUnpublished, dev does not imply on: locally the seal key is
  // present, so real content is available and fixtures would only be clutter.
  it('is not implied by local dev', () => {
    expect(showFixtures({ DEV: true })).toBe(false);
  });
});

describe('showResume', () => {
  it('is off unless explicitly enabled', () => {
    expect(showResume({})).toBe(false);
    expect(showResume({ PUBLIC_SHOW_RESUME: 'false' })).toBe(false);
  });

  it('is on for the exact string "true"', () => {
    expect(showResume({ PUBLIC_SHOW_RESUME: 'true' })).toBe(true);
  });

  // The whole reason this flag exists: the resume must be able to ship while
  // A.I.R. stays hidden, so neither flag may imply the other.
  it('is independent of the A.I.R. flag', () => {
    // Each helper's JSDoc names only its own flag, so passing the *other* one is
    // two different type errors: an excess property on a fresh literal, and
    // ts2559 for an object sharing no property with an all-optional parameter.
    // Declaring both on one bound type says what the test means and satisfies
    // each signature — which is exactly the case worth asserting.
    type Env = { PUBLIC_SHOW_AIR?: string; PUBLIC_SHOW_RESUME?: string };
    const airOnly: Env = { PUBLIC_SHOW_AIR: 'true' };
    const resumeOnly: Env = { PUBLIC_SHOW_RESUME: 'true' };
    expect(showResume(airOnly)).toBe(false);
    expect(showAIR(resumeOnly)).toBe(false);
  });

  it('is not implied by dev mode', () => {
    expect(showResume({ DEV: true })).toBe(false);
  });
});

describe('showResumePrint', () => {
  // This flag guards routes that render the resume *with* contact details, for
  // the PDF generator to print. Reaching them any other way defeats the gate,
  // so the closed cases matter more here than the open one.
  it('is off unless explicitly enabled', () => {
    expect(showResumePrint({})).toBe(false);
    expect(showResumePrint({ PUBLIC_RESUME_PRINT: 'false' })).toBe(false);
  });

  it('is on for the exact string "true"', () => {
    expect(showResumePrint({ PUBLIC_RESUME_PRINT: 'true' })).toBe(true);
  });

  it('is not implied by local dev', () => {
    expect(showResumePrint({ DEV: true })).toBe(false);
  });

  it('rejects anything truthy-but-not-"true"', () => {
    for (const value of ['1', 'yes', 'TRUE', 'True', ' true', '', undefined]) {
      expect(showResumePrint({ PUBLIC_RESUME_PRINT: value }), String(value)).toBe(false);
    }
  });
});
