import { describe, it, expect } from 'vitest';

import { selectContext, distinctiveTerms } from './retrieval.mjs';

/**
 * Retrieval, as BM25 plus a coverage gate.
 *
 * ## What replaced what, and why
 *
 * The scorer was a hand-rolled IR engine: a hand-written stopword list, a
 * hand-written suffix stemmer, flat integer field weights, and a fixed integer
 * floor. It worked while the corpus was STAR stories and projects, whose titles
 * describe *work*. The resume profile is the first entry titled with the
 * subject rather than the subject matter — "Eddie Freeman — Senior Product
 * Engineer" — and `title` weighed 4 against a floor of 3, so every question
 * naming Eddie retrieved it. All five boundary cases started retrieving, and the
 * guarantee downgraded from "impossible to answer" to "the prompt asked it not
 * to".
 *
 * The missing idea was IDF. In a corpus entirely about one person, that person's
 * name carries no discriminating signal — and IDF derives that from the corpus
 * rather than from a list somebody has to remember to extend.
 *
 * ## The gate is coverage, not a threshold
 *
 * BM25 scores are unbounded and their scale moves as content is added, so a
 * fixed floor stops meaning anything. The question worth asking is not "did
 * something score high enough" but "do the distinctive words of this question
 * have any support in the corpus at all" — which is the boundary guarantee
 * stated directly.
 */

/** A corpus shaped like the real one: work-titled stories, a person-titled profile. */
const CORPUS = [
  {
    id: 'platform-migration',
    data: {
      title: 'Migrating a payments platform without downtime',
      tags: ['ci-cd', 'migration', 'payments'],
      situation: 'Eddie inherited a platform nobody wanted to own.',
      result: 'Shipped incrementally over two quarters.',
    },
  },
  {
    id: 'build-vs-buy',
    data: {
      title: 'Choosing to buy the scheduler',
      tags: ['build-vs-buy', 'procurement'],
      situation: 'Eddie was asked whether to build a scheduler.',
      result: 'Bought it, and wrote up why.',
    },
  },
  {
    id: 'resume/profile/profile',
    data: {
      title: 'Eddie Freeman — Senior Product Engineer · AI-Native',
      tags: ['summary', 'overview', 'about', 'who-is-eddie', 'experience'],
      summary: 'Eddie Freeman is a senior product engineer.',
    },
  },
];

describe('the boundary guarantee', () => {
  /*
   * These mirror the `boundary` cases in evals/cases.mjs. Each must decline by
   * retrieving nothing — not by the model choosing to decline. That distinction
   * is the whole guarantee: it holds even if the prompt is ignored entirely,
   * because no request is made.
   */

  it('declines a question whose distinctive terms have no corpus support', () => {
    // The failure that started this: "eddie" hit the profile title at weight 4
    // and cleared a floor of 3, so a question about a restaurant retrieved a
    // resume.
    expect(
      selectContext('What is Eddie’s favourite restaurant in Lisbon?', CORPUS),
    ).toEqual([]);
  });

  it('declines a question presupposing an employer the corpus never mentions', () => {
    expect(selectContext('What did Eddie do while he was at Google?', CORPUS)).toEqual(
      [],
    );
  });

  it('declines speculation about a real person’s decisions', () => {
    expect(
      selectContext('Would Eddie accept a role paying under market rate?', CORPUS),
    ).toEqual([]);
  });

  it('does not let the subject’s own name make a question answerable', () => {
    // The property the whole rework exists for. "eddie" appears throughout the
    // corpus, so IDF drives it toward zero and it can never carry a question on
    // its own.
    const named = selectContext('Tell me what Eddie thinks about Lisbon', CORPUS);
    const unnamed = selectContext('Tell me what he thinks about Lisbon', CORPUS);

    expect(named).toEqual([]);
    expect(unnamed).toEqual([]);
  });
});

describe('recall — the counterweight', () => {
  /*
   * Guardrails tightened until everything declines would pass every test above
   * and be worthless. Each of these encodes a real past regression.
   */

  it('retrieves on a compound tag matched as a phrase', () => {
    // `terms()` used to split `ci-cd` into two 2-character tokens and drop
    // both, so no question about CI/CD could reach the story about CI/CD.
    const hits = selectContext('how do you handle ci cd', CORPUS);

    expect(hits.map((entry) => entry.id)).toContain('platform-migration');
  });

  it('retrieves when every word of a compound tag matches in another order', () => {
    // Two lone fragments scored 2 and fell under the floor, so the phrasing a
    // visitor is most likely to use retrieved nothing.
    const hits = selectContext('how does he decide whether to build or buy', CORPUS);

    expect(hits.map((entry) => entry.id)).toContain('build-vs-buy');
  });

  it('retrieves the resume for a question actually about his experience', () => {
    // Raising the bar for the boundary must not make the resume unreachable,
    // or the guarantee is bought by breaking every real question.
    const hits = selectContext(
      'What is his experience as a senior product engineer?',
      CORPUS,
    );

    expect(hits.map((entry) => entry.id)).toContain('resume/profile/profile');
  });

  it('tolerates a misspelling', () => {
    // The "light inference" half: associative without embeddings.
    const hits = selectContext('tell me about the payements migration', CORPUS);

    expect(hits.map((entry) => entry.id)).toContain('platform-migration');
  });
});

describe('contract', () => {
  it('orders most-relevant first', () => {
    const hits = selectContext('payments platform migration downtime', CORPUS);

    expect(hits[0].id).toBe('platform-migration');
  });

  it('never returns more than the limit', () => {
    expect(
      selectContext('platform migration payments scheduler', CORPUS, { limit: 1 }),
    ).toHaveLength(1);
  });

  it('is stable across identical calls', () => {
    // Drift evals report noise as regression if the same question retrieves a
    // different set between runs.
    const once = selectContext('how do you handle ci cd', CORPUS);
    const twice = selectContext('how do you handle ci cd', CORPUS);

    expect(once.map((e) => e.id)).toEqual(twice.map((e) => e.id));
  });

  it('returns an empty selection for an empty corpus rather than throwing', () => {
    expect(selectContext('anything at all', [])).toEqual([]);
  });

  it('still answers an overview question, which has no distinctive terms', () => {
    // `grounding/why-work-with-him` — the question the feature exists to
    // answer. It names nothing specific, so coverage alone would decline it;
    // the overview path is what catches it, and it must survive the rework.
    expect(
      selectContext('Why should I work with Eddie Freeman?', CORPUS).length,
    ).toBeGreaterThan(0);
  });
});

describe('distinctiveTerms', () => {
  it('excludes a term that appears in most of the corpus', () => {
    // "eddie" is in every document here, so it discriminates nothing.
    expect(distinctiveTerms('what did eddie do in lisbon', CORPUS)).not.toContain(
      'eddie',
    );
  });

  it('keeps a term the corpus has never seen', () => {
    // Absent is maximally distinctive — and absent is exactly what makes a
    // question unanswerable, so this is the signal the gate runs on.
    expect(distinctiveTerms('what did eddie do in lisbon', CORPUS)).toContain(
      'lisbon',
    );
  });

  it('drops grammatical glue', () => {
    const terms = distinctiveTerms('what did he do about the thing', CORPUS);

    expect(terms).not.toContain('what');
    expect(terms).not.toContain('the');
  });
});
