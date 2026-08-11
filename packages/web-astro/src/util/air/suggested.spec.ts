import { describe, it, expect } from 'vitest';

import {
  SUGGESTED,
  LANES,
  GENERAL_LANE,
  seedsForLane,
  suggestionsFor,
  suggestionSentence,
} from './suggested.mjs';
import { isVariantSlug } from '../resume/variants.mjs';

describe('suggested questions', () => {
  it('tags every suggestion with a lane the chooser renders', () => {
    for (const item of SUGGESTED) {
      expect(item.lane, item.question).toBeTruthy();
      expect(LANES, item.question).toContain(item.lane);
    }
  });

  /*
   * A lane is either a variant slug — so it can boost retrieval and match the
   * page a visitor came from — or the explicit catch-all. A third kind would be
   * a vocabulary nothing downstream knows how to act on.
   */
  it('uses variant slugs or the catch-all as lanes', () => {
    for (const lane of LANES) {
      expect(lane === GENERAL_LANE || isVariantSlug(lane), lane).toBe(true);
    }
  });

  it('gives every lane at least three questions to rotate through', () => {
    for (const lane of LANES) {
      expect(seedsForLane(lane).length, lane).toBeGreaterThanOrEqual(3);
    }
  });

  it('returns nothing for a lane that does not exist', () => {
    expect(seedsForLane('nope')).toEqual([]);
  });

  it('writes every question as a question', () => {
    for (const item of SUGGESTED) {
      expect(item.question, item.question).toMatch(/\?$/);
    }
  });

  it('names an audience for every question', () => {
    for (const item of SUGGESTED) {
      expect(item.audience, item.question).toBeTruthy();
    }
  });

  describe('what to offer someone who does not know what to ask', () => {
    // The pool is twelve. Rendering it whole replaces one decision with a
    // longer one, which is the opposite of what the prompt is for.
    it('offers a short list, not the whole pool', () => {
      expect(suggestionsFor().length).toBeLessThanOrEqual(4);
      expect(suggestionsFor().length).toBeGreaterThan(0);
    });

    it('spans the lanes when it has no lane to go on', () => {
      const lanes = suggestionsFor().map((item) => item.lane);
      expect(new Set(lanes).size).toBe(lanes.length);
    });

    it('leads with the lane the visitor arrived under', () => {
      const offered = suggestionsFor('solutions');
      expect(offered[0].lane).toBe('solutions');
      expect(offered.slice(0, 3).every((item) => item.lane === 'solutions')).toBe(
        true,
      );
    });

    // A lane is a hint, not a filter — here too. Someone in one lane can still
    // be shown a question from another once theirs are spent.
    it('tops up from other lanes rather than running short', () => {
      expect(suggestionsFor('solutions', 6)).toHaveLength(6);
    });

    it('falls back to the spread for a lane that does not exist', () => {
      expect(suggestionsFor('nope')).toEqual(suggestionsFor());
    });
  });

  it('still quotes suggestions for the decline message', () => {
    expect(suggestionSentence(2)).toMatch(/^“.+” or “.+”$/);
    expect(suggestionSentence(1)).toMatch(/^“.+”$/);
    expect(suggestionSentence(0)).toBe('');
  });
});
