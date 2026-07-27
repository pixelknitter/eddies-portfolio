/**
 * Retrieval for A.I.R. — selects which STAR stories and projects an answer may
 * draw on.
 *
 * This is the load-bearing guardrail, not the model prompt. A model told to
 * "only use the provided context" still cannot invent what it was never given,
 * so the smaller and more relevant this selection, the narrower the blast
 * radius of anything the prompt fails to prevent. When nothing here scores
 * above the floor the endpoint declines rather than asking the model to answer
 * from nothing — refusal is a retrieval outcome, not a model decision.
 *
 * Deliberately lexical rather than embedding-based: the corpus is a few dozen
 * short documents bundled at build time, so an index costs a runtime
 * dependency and a datastore to solve a problem this size does not have.
 */

/** Words carrying no retrieval signal. Kept small — over-stripping loses recall. */
const STOPWORDS = new Set([
  'a', 'about', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'but', 'by',
  'can', 'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'he',
  'her', 'him', 'his', 'how', 'i', 'if', 'in', 'is', 'it', 'its', 'me',
  'my', 'of', 'on', 'or', 'she', 'should', 'so', 'than', 'that', 'the',
  'their', 'them', 'then', 'there', 'they', 'this', 'to', 'was', 'we',
  'were', 'what', 'when', 'which', 'who', 'why', 'will', 'with', 'would',
  'you', 'your',
]);

/**
 * Field weights. Title and tags are curated and short, so a hit there is a
 * stronger signal than the same word buried in a paragraph of narrative.
 */
const WEIGHTS = {
  title: 4,
  tags: 3,
  result: 2,
  situation: 1,
  task: 1,
  action: 1,
};

/**
 * Minimum score an entry must reach to be offered to the model.
 *
 * Set above zero on purpose: a single incidental word overlap ("the team")
 * is not relevance, and passing weak matches through is what produces
 * confident answers about work that has nothing to do with the question.
 */
export const RELEVANCE_FLOOR = 3;

/** Most entries handed to the model. Bounds both prompt cost and drift. */
export const MAX_ENTRIES = 4;

/**
 * Split text into comparable terms.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function terms(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 2 && !STOPWORDS.has(term));
}

/**
 * Score one corpus entry against a question's terms.
 *
 * @param {string[]} questionTerms
 * @param {Record<string, unknown>} entry  A `star` or `projects` entry's data.
 * @returns {number}
 */
export function scoreEntry(questionTerms, entry) {
  if (questionTerms.length === 0) return 0;

  const unique = new Set(questionTerms);
  let score = 0;

  for (const [field, weight] of Object.entries(WEIGHTS)) {
    const value = entry?.[field];
    if (value == null) continue;

    const fieldTerms = new Set(
      terms(Array.isArray(value) ? value.join(' ') : String(value))
    );

    // Count distinct matching terms rather than occurrences: repeating a word
    // inside one long narrative field should not outrank matching two
    // different words, which is a much better relevance signal.
    for (const term of unique) {
      if (fieldTerms.has(term)) score += weight;
    }
  }

  return score;
}

/**
 * Select the entries an answer may cite.
 *
 * @param {string} question
 * @param {Array<{id: string, data: Record<string, unknown>}>} entries
 * @param {{floor?: number, limit?: number}} [options]
 * @returns {Array<{id: string, score: number, data: Record<string, unknown>}>}
 *   Ordered most-relevant first. Empty when nothing clears the floor — the
 *   caller must treat that as "decline", not as "answer with no context".
 */
export function selectContext(question, entries, options = {}) {
  const { floor = RELEVANCE_FLOOR, limit = MAX_ENTRIES } = options;
  const questionTerms = terms(question);

  return entries
    .map((entry) => ({
      id: entry.id,
      score: scoreEntry(questionTerms, entry.data),
      data: entry.data,
    }))
    .filter((entry) => entry.score >= floor)
    // Tie-break on id so identical scores produce a stable order. Without
    // this the same question can retrieve a different set between requests,
    // which makes drift evals report noise as regression.
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}
