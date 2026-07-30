/**
 * The questions A.I.R. offers a visitor — rendered as buttons and named in the
 * decline message, so both read from here.
 *
 * Every entry is a promise the page makes, so offline.spec.ts asserts each one
 * retrieves context. A question nothing answers fails the build.
 */

/**
 * @typedef {object} Suggestion
 * @property {string} audience  Who the question is written for.
 * @property {string} question
 */

/** @type {Suggestion[]} */
export const SUGGESTED = [
  {
    audience: 'Hiring manager',
    question: 'How does Eddie approach a system nobody wants to own?',
  },
  {
    audience: 'Client',
    question: 'How quickly can Eddie prove out an MVP?',
  },
  {
    audience: 'Partner',
    question: 'How does Eddie work with a team that is not his own?',
  },
];

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
