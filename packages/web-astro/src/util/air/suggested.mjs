/**
 * The questions A.I.R. offers a visitor.
 *
 * One list, in one place, because there were three copies: the buttons in the
 * React island, the prose suggestions in the decline message, and nothing in the
 * eval set. They drifted, and the result was visible — A.I.R. declined the
 * Client question with "that isn't something Eddie's written work covers… try
 * asking what he does when requirements are still moving", which was *the same
 * question it had just declined*. A suggestion loop pointing at itself.
 *
 * Anything here is a promise the site makes on the front page, so
 * offline.spec.ts asserts every one of these retrieves context. A question that
 * cannot be answered belongs nowhere near this array.
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
    // Replaces "What does Eddie do when the requirements are still moving?",
    // which retrieved nothing: no story's title, tags or result mentions
    // requirements or scope. This one lands on the MVP story instead.
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
 * Built from the same array the buttons use so the two can never disagree again
 * — the loop above existed only because this text was hand-written.
 *
 * Questions are quoted verbatim rather than folded into the sentence. Lowercasing
 * the lead-in produced "Try asking about how does Eddie approach a system nobody
 * wants to own", because a question keeps its inverted word order and will not sit
 * inside a prepositional phrase. Quoting it sidesteps the grammar entirely and
 * has the side benefit that the visitor sees the exact wording that works.
 *
 * @param {number} [limit] How many to name.
 * @returns {string}
 */
export function suggestionSentence(limit = 2) {
  const questions = SUGGESTED.slice(0, limit).map((item) => `“${item.question}”`);

  if (questions.length === 0) return '';
  if (questions.length === 1) return questions[0];

  return `${questions.slice(0, -1).join(', ')} or ${questions[questions.length - 1]}`;
}
