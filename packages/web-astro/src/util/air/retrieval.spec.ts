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

/**
 * A corpus shaped like the real one.
 *
 * Critically, the subject's name appears in **one** entry, not all of them.
 * An earlier version of this fixture had "Eddie" in every document, which
 * encoded the assumption under test — that IDF would drive the name to zero —
 * and so passed while the real corpus failed. In the real corpus stories are
 * titled after the *work* and rarely name him, which makes his name rare, and
 * therefore maximally distinctive. A fixture that assumes the hypothesis cannot
 * test it.
 */
const CORPUS = [
  {
    id: 'platform-migration',
    data: {
      title: 'Migrating a payments platform without downtime',
      tags: ['ci-cd', 'migration', 'payments'],
      situation: 'Inherited a payments platform nobody wanted to own.',
      result: 'Shipped incrementally over two quarters.',
    },
  },
  {
    id: 'build-vs-buy',
    data: {
      title: 'Choosing to buy the scheduler',
      tags: ['build-vs-buy', 'procurement'],
      situation: 'Asked whether to build or buy a scheduler.',
      result: 'Bought it, and wrote up why.',
    },
  },
  {
    id: 'resume/profile/profile',
    data: {
      title: 'Eddie Freeman — Senior Product Engineer · AI-Native',
      role: 'Senior Product Engineer, engineering leadership',
      tags: ['summary', 'overview', 'about', 'who-is-eddie', 'experience'],
      summary: 'Eddie Freeman is a senior product engineer.',
    },
  },
  {
    id: 'mvp-in-a-fortnight',
    data: {
      title: 'Proving an MVP in a fortnight',
      tags: ['mvp', 'prototyping'],
      situation: 'A client needed to know whether an idea was worth funding.',
      result: 'Shipped a working MVP in two weeks and killed the bad half.',
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

describe('the subject’s name is not a retrieval signal', () => {
  it('declines even though the name is rare, and therefore high-IDF', () => {
    // The correction that mattered. Frequency cannot express "this token names
    // the subject of the whole corpus"; a rare name is *more* distinctive, not
    // less. It has to be declared.
    expect(
      selectContext('What is Eddie Freeman’s favourite restaurant?', CORPUS),
    ).toEqual([]);
  });

  it('excludes the subject from the distinctive terms of a question', () => {
    expect(distinctiveTerms('what did eddie freeman do', CORPUS)).not.toContain(
      'eddie',
    );
    expect(distinctiveTerms('what did eddie freeman do', CORPUS)).not.toContain(
      'freeman',
    );
  });
});

describe('support, not coverage', () => {
  /*
   * ## Why this is one matched term and not a share
   *
   * A share was tried, at a half, and it is what this replaced. It could not
   * separate the two cases it had to:
   *
   *   "How quickly can Eddie prove out an MVP?"   mvp        1 of 3 = 0.33
   *   "How many years as a VP of Engineering?"    engineering 1 of 4 = 0.25
   *
   * Eight hundredths apart, on opposite sides of the decision. Weighting by IDF
   * instead of counting makes it *worse*, not better: a term the corpus has
   * never seen carries the highest IDF of all, so "quickly" and "prove" —
   * absent, and the reason the question looks thin — swamp "mvp" and drive the
   * matched share down to 0.26.
   *
   * The reason no scalar worked is that the gate was being asked two different
   * questions. Retrieval can prove a *topic* is absent. It cannot tell that a
   * title is fabricated when the corpus is full of real titles, because the
   * evidence for "VP of Engineering" and for "MVP" looks identical from here:
   * one distinctive term, present in the corpus.
   *
   * So the jobs are split. This gate answers only the question retrieval can
   * answer — is there *any* support for what makes this question specific — and
   * a false premise about a topic the corpus does cover is declined by the
   * answer, with the real facts in hand to contradict it. See the `declineBy`
   * field in evals/cases.mjs, which records which guarantee each case rests on.
   */

  it('declines when nothing distinctive about the question is supported', () => {
    // Unchanged, and the half of the guarantee that stays structural: no
    // request is made, so it holds even if the prompt is ignored entirely.
    expect(
      selectContext('What is Eddie’s favourite restaurant in Lisbon?', CORPUS),
    ).toEqual([]);
  });

  it('admits on a single rare term that the corpus genuinely covers', () => {
    // `suggested` (client). "mvp" is one of three distinctive terms and the
    // share gate rejected it, so a question the corpus answers well got a
    // decline — on the page, under a button inviting the visitor to ask it.
    const hits = selectContext('How quickly can Eddie prove out an MVP?', CORPUS);

    expect(hits.map((entry) => entry.id)).toContain('mvp-in-a-fortnight');
  });

  it('admits a question whose phrasing shares little with the story', () => {
    // `grounding/covered-question`, and the suggested hiring-manager question.
    // The story says "Inherited a payments platform nobody wanted to own"; the
    // question says "a system nobody wants to own". Real support, thin overlap.
    const hits = selectContext(
      'How does Eddie approach a system nobody wants to own?',
      CORPUS,
    );

    expect(hits.map((entry) => entry.id)).toContain('platform-migration');
  });

  it('lets a fabricated title through to the answer layer, deliberately', () => {
    /*
     * `boundary/invented-tenure`, and the case that moved. "engineering" is
     * real support — it is genuinely in the corpus — so retrieval admits, and
     * the resume goes to the model *stating the actual titles*. Declining here
     * instead would cost every question above.
     *
     * This is a weaker guarantee than the structural one and is written down as
     * such: prompt.mjs carries the rule, and the live harness grades it.
     */
    const hits = selectContext(
      'How many years did Eddie spend as a VP of Engineering?',
      CORPUS,
    );

    expect(hits.map((entry) => entry.id)).toContain('resume/profile/profile');
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
