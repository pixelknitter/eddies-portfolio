/**
 * The questions A.I.R. offers a visitor — rendered as buttons, rotated on the
 * CV chooser, and named in the decline message, so all three read from here.
 *
 * Every entry is a promise the page makes, so offline.spec.ts asserts each one
 * retrieves context. A question nothing answers fails the build.
 *
 * ## Why a lane and not just an audience
 *
 * `audience` says who is asking. `lane` says what they are hiring for, and it
 * is a variant slug on purpose: a visitor who picks a solutions question has
 * told us something retrieval can use, and reusing the slug means there is no
 * second vocabulary to keep aligned with the first.
 *
 * `general` is the explicit catch-all for questions that belong to no
 * particular role. Explicit rather than an absent field, so no consumer has to
 * decide what undefined means.
 *
 * A lane is a hint, never a filter. See `selectContext` in retrieval.mjs: the
 * best answer to a question wins on relevance regardless of lane, and the lane
 * only breaks ties in framing.
 */

import { VARIANTS } from '../resume/variants.mjs';

/**
 * @typedef {object} Suggestion
 * @property {string} audience  Who the question is written for.
 * @property {string} question
 * @property {string} lane      A variant slug, or 'general'.
 */

/** The catch-all lane, for questions that belong to no particular role. */
export const GENERAL_LANE = 'general';

/** @type {Suggestion[]} */
export const SUGGESTED = [
  /*
   * Product and AI-native. The default lane, and the first entries are the ones
   * `suggestionSentence` quotes in the decline message, so they stay the
   * broadest questions in the list.
   */
  {
    audience: 'Hiring manager',
    question: 'How does Eddie approach a system nobody wants to own?',
    lane: 'product',
  },
  {
    audience: 'Client',
    question: 'How quickly can Eddie prove out an MVP?',
    lane: 'product',
  },
  {
    audience: 'Hiring manager',
    question: 'What has Eddie shipped with agents in production?',
    lane: 'product',
  },

  // Solutions engineering.
  {
    audience: 'Partner',
    question: 'How does Eddie work with a team that is not his own?',
    lane: 'solutions',
  },
  {
    audience: 'Sales engineer',
    question: 'Has Eddie run a technical evaluation with a vendor?',
    lane: 'solutions',
  },
  {
    audience: 'Hiring manager',
    question: 'How does Eddie explain a platform to a non-technical buyer?',
    lane: 'solutions',
  },

  /*
   * Engineering leadership. The variant has no prose yet, which does not matter
   * here: a seed has to be answerable from the corpus, not from a particular
   * document. These are answerable today.
   */
  {
    audience: 'Hiring manager',
    question: 'How does Eddie bring a team along through a migration?',
    lane: 'leadership',
  },
  {
    audience: 'Founder',
    question: 'How does Eddie decide what not to build?',
    lane: 'leadership',
  },
  {
    audience: 'Hiring manager',
    question: 'How does Eddie handle an incident, and what changes after?',
    lane: 'leadership',
  },

  /*
   * No particular role.
   *
   * This lane opens on the honest question deliberately — a record that only
   * answers flattering questions is a brochure. It reads "still working on"
   * rather than "worst at" because that is the one the corpus can actually
   * answer: `challenges` is the collection built to field the blunter phrasing
   * and it currently holds nothing but its template, so "What is Eddie worst
   * at?" retrieves nothing and the button would decline. Restore the sharper
   * wording once there are challenge entries to ground it.
   */
  {
    audience: 'Anyone',
    question: 'What is Eddie still working on getting better at?',
    lane: GENERAL_LANE,
  },
  {
    audience: 'Anyone',
    question: 'What does Eddie build outside of work?',
    lane: GENERAL_LANE,
  },
  {
    audience: 'Recruiter',
    question: 'Where has Eddie worked, and for how long?',
    lane: GENERAL_LANE,
  },
];

/**
 * Every lane in use, in registry order with the catch-all last.
 *
 * Derived rather than declared, so a suggestion cannot name a lane the chooser
 * does not render, and a lane cannot outlive the last question in it.
 *
 * @type {ReadonlyArray<string>}
 */
export const LANES = Object.freeze([
  ...VARIANTS.map((variant) => variant.slug).filter((slug) =>
    SUGGESTED.some((item) => item.lane === slug),
  ),
  ...(SUGGESTED.some((item) => item.lane === GENERAL_LANE)
    ? [GENERAL_LANE]
    : []),
]);

/**
 * @param {string} lane
 * @returns {Suggestion[]}
 */
export function seedsForLane(lane) {
  return SUGGESTED.filter((item) => item.lane === lane);
}

/**
 * What to offer a visitor who does not know what to ask.
 *
 * `SUGGESTED` is now a pool of twelve rather than a list of three, because the
 * chooser rotates through each lane. Nothing should render the pool whole: a
 * "not sure where to start?" prompt followed by twelve buttons has replaced one
 * decision with a longer one.
 *
 * With a lane, that lane's questions come first — the visitor is on a page that
 * already said what they are hiring for. Without one, it takes one question per
 * lane, so the offer shows the breadth of what the record can answer instead of
 * three questions about the same thing.
 *
 * @param {string} [lane] The variant slug the asker arrived under.
 * @param {number} [limit]
 * @returns {Suggestion[]}
 */
export function suggestionsFor(lane, limit = 4) {
  if (lane && seedsForLane(lane).length > 0) {
    return [
      ...seedsForLane(lane),
      ...SUGGESTED.filter((item) => item.lane !== lane),
    ].slice(0, limit);
  }

  const oneEach = LANES.map((each) => seedsForLane(each)[0]).filter(Boolean);
  return oneEach.slice(0, limit);
}

/**
 * The suggestions quoted, joined for a decline message.
 *
 * Quoted verbatim rather than folded into the sentence: a question keeps its
 * inverted word order and will not sit inside a prepositional phrase.
 *
 * @param {number} [limit] How many to name.
 * @returns {string}
 */
export function suggestionSentence(limit = 2) {
  const questions = SUGGESTED.slice(0, limit).map(
    (item) => `“${item.question}”`,
  );

  if (questions.length === 0) return '';
  if (questions.length === 1) return questions[0];

  return `${questions.slice(0, -1).join(', ')} or ${questions[questions.length - 1]}`;
}
