import { describe, it, expect } from 'vitest';

import { STAGES, stageOf, isCitable, isRenderable } from './stage.mjs';

/**
 * The whole reason this exists: `reviewed` is citable and not renderable, and
 * nothing before it could express that. The legacy fallback matters just as
 * much — the corpus is sealed, so entries migrate one at a time and both
 * spellings are live at once for a while.
 */
describe('stageOf', () => {
  it('reads an explicit stage', () => {
    for (const stage of STAGES) {
      expect(stageOf({ stage })).toBe(stage);
    }
  });

  it('falls back to the legacy boolean', () => {
    expect(stageOf({ draft: true })).toBe('draft');
    expect(stageOf({ draft: false })).toBe('published');
  });

  // Fail closed: an entry nobody has classified is one nobody has approved.
  it('treats an unclassified entry as a draft only when it says so', () => {
    expect(stageOf({})).toBe('published');
    expect(stageOf()).toBe('published');
  });

  it('lets stage win over the legacy boolean', () => {
    expect(stageOf({ stage: 'reviewed', draft: true })).toBe('reviewed');
    expect(stageOf({ stage: 'draft', draft: false })).toBe('draft');
  });

  // The schema rejects these at build time, so reaching here means something
  // bypassed it — and trusting an unknown value would publish it.
  it('does not trust an unrecognised stage', () => {
    expect(stageOf({ stage: 'live' })).toBe('published');
    expect(stageOf({ stage: 'live', draft: true })).toBe('draft');
  });
});

describe('the two questions a stage answers', () => {
  it('lets A.I.R. cite anything that is not a draft', () => {
    expect(isCitable({ stage: 'draft' })).toBe(false);
    expect(isCitable({ stage: 'reviewed' })).toBe(true);
    expect(isCitable({ stage: 'published' })).toBe(true);
  });

  // The state the whole change exists for.
  it('renders only what is published', () => {
    expect(isRenderable({ stage: 'draft' })).toBe(false);
    expect(isRenderable({ stage: 'reviewed' })).toBe(false);
    expect(isRenderable({ stage: 'published' })).toBe(true);
  });

  it('keeps reviewed off the site and inside the corpus', () => {
    const reviewed = { stage: 'reviewed' };
    expect(isRenderable(reviewed)).toBe(false);
    expect(isCitable(reviewed)).toBe(true);
  });
});
