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

/**
 * Words carrying no retrieval signal. Kept small — over-stripping loses recall.
 *
 * Prepositions included: title weight is 4, so a single one matching a title
 * cleared the relevance floor on its own.
 */
const STOPWORDS = new Set([
  'a',
  'about',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'can',
  'did',
  'do',
  'does',
  'for',
  'from',
  'had',
  'has',
  'have',
  'he',
  'her',
  'him',
  'his',
  'how',
  'i',
  'if',
  'in',
  'is',
  'it',
  'its',
  'me',
  'my',
  'of',
  'on',
  'or',
  'she',
  'should',
  'so',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'they',
  'this',
  'to',
  'was',
  'we',
  'were',
  'what',
  'when',
  'which',
  'who',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
  // Prepositions and comparatives — grammatical glue, never a topic.
  'after',
  'before',
  'below',
  'between',
  'during',
  'into',
  'like',
  'most',
  'much',
  'many',
  'onto',
  'other',
  'out',
  'over',
  'per',
  'some',
  'such',
  'under',
  'until',
  'upon',
  'via',
  'while',
  'without',
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
  // Resume entries. New keys only, so STAR and project scores are unchanged —
  // an entry is scored on the fields it has, and no existing entry has these.
  //
  // `org` and `role` match `title`'s weight because a question naming an employer
  // or a job title is naming the entry almost exactly. `summary` sits with the
  // narrative fields. Bullets live in the markdown body and are not scored at all:
  // scoring reads frontmatter, which is why resume tags carry the vocabulary a
  // question is actually asked in rather than only the stack.
  org: 4,
  role: 4,
  summary: 1,
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
 * Derivational suffixes, stripped repeatedly. Longest first, so `reliability`
 * loses `ability` and reaches `reliable`'s stem rather than stopping at
 * `reliabil`.
 */
const SUFFIXES = [
  'ibility',
  'ability',
  'ization',
  'ation',
  'ility',
  'ible',
  'able',
  'ship',
  'ment',
  'ness',
  'ing',
  'ion',
  'ity',
  'ers',
  'er',
  'ed',
];

/** Shortest stem allowed. Below this, stripping merges genuinely different words. */
const MIN_STEM = 3;

/**
 * Strip a plural, at most once, before the derivational loop.
 *
 * Folding plurals into that loop over-stems: `releases` → `releas` → `relea`,
 * while `release` has nothing to strip, so the pair stops matching.
 *
 * @param {string} word
 * @returns {string}
 */
function depluralize(word) {
  // "releases" → "release", "batches" → "batch": the e belongs to the stem in
  // the first and to the suffix in the second.
  if (/(?:s|z|ch|sh|x)es$/.test(word) && word.length - 2 >= MIN_STEM) {
    return word.slice(0, /(?:ch|sh)es$/.test(word) ? -2 : -1);
  }
  // "systems" → "system", but never "ss" ("business" is not a plural).
  if (/[^s]s$/.test(word) && word.length - 1 >= MIN_STEM)
    return word.slice(0, -1);
  return word;
}

/**
 * Reduce a term to a comparable stem.
 *
 * Not a Porter stemmer: a dependency buys accuracy a relevance floor of 3
 * cannot perceive. The loop repeats because the words here are doubly suffixed
 * — ownership → owner → own.
 *
 * @param {string} term
 * @returns {string}
 */
export function stem(term) {
  let current = depluralize(String(term ?? ''));

  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of SUFFIXES) {
      if (
        current.length - suffix.length >= MIN_STEM &&
        current.endsWith(suffix)
      ) {
        current = current.slice(0, -suffix.length);
        changed = true;
        break;
      }
    }
  }

  return current;
}

/** Stems of every scoreable term in a text, deduplicated. */
function stems(text) {
  return new Set(terms(text).map(stem));
}

/**
 * Weight for a word appearing inside a compound tag (`cost-engineering`).
 *
 * A fragment is a hint, not the topic: at full tag weight, "VP of Engineering"
 * scored a topical hit on `cost-engineering` and made an unanswerable question
 * retrievable.
 */
const TAG_FRAGMENT_WEIGHT = 1;

/**
 * Collapse text to space-delimited alphanumeric words, padded so `includes`
 * tests match on word boundaries rather than mid-word (` ai ` must not hit
 * "said").
 *
 * @param {unknown} text
 * @returns {string}
 */
function normalize(text) {
  return ` ${String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

/**
 * Score a curated tag list: whole tag first, fragments only as a fallback.
 *
 * @param {string} questionNorm  Output of `normalize` on the question.
 * @param {Set<string>} questionTerms
 * @param {string[]} tags
 * @returns {number}
 */
function scoreTags(questionNorm, questionTerms, tags) {
  let score = 0;

  for (const tag of tags) {
    const phrase = normalize(tag);

    // The whole curated tag appears in the question — the strongest signal
    // available, and it works for short and multi-word tags alike.
    if (phrase.trim() !== '' && questionNorm.includes(phrase)) {
      score += WEIGHTS.tags;
      continue;
    }

    const fragments = stems(tag);
    let matched = 0;
    for (const fragment of fragments) {
      if (questionTerms.has(fragment)) matched += 1;
    }

    // Matching every scoreable word of a compound tag *is* matching the tag,
    // even in a different order. "decide whether to build or buy" hits both
    // halves of `build-vs-buy`, which as two lone fragments scored 2 and fell
    // just under the floor — the one phrasing a visitor is most likely to use
    // was the one that retrieved nothing.
    score +=
      matched > 1 && matched === fragments.size
        ? WEIGHTS.tags
        : matched * TAG_FRAGMENT_WEIGHT;
  }

  return score;
}

/**
 * Score one corpus entry against a question.
 *
 * Takes the question text rather than pre-split terms: matching a compound tag
 * requires the original word order, which a term array has already discarded.
 *
 * @param {string} question
 * @param {Record<string, unknown>} entry  A `star` or `projects` entry's data.
 * @returns {number}
 */
export function scoreEntry(question, entry) {
  const unique = stems(question);
  if (unique.size === 0) return 0;

  const questionNorm = normalize(question);
  let score = 0;

  for (const [field, weight] of Object.entries(WEIGHTS)) {
    const value = entry?.[field];
    if (value == null) continue;

    if (field === 'tags') {
      score += scoreTags(
        questionNorm,
        unique,
        Array.isArray(value) ? value : [String(value)],
      );
      continue;
    }

    const fieldTerms = stems(String(value));

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
 * Stems of words that ask about the whole body of work rather than a topic in
 * it — "why should I work with him", "what is his background".
 *
 * These questions have no lexical hook by construction: nothing in a story
 * about a Swift migration contains the word "work" in a scored field, so the
 * single question A.I.R. exists to answer scored zero against every story and
 * was declined. That is a retrieval failure, not an honest gap.
 *
 * Kept to words that are only ever asked *about a person's career*. A question
 * naming something absent from the corpus ("favourite restaurant", "salary
 * history") shares none of them and still declines — the boundary guarantee is
 * unchanged, which is the property that makes this safe.
 */
const OVERVIEW_TERMS = new Set(
  [
    'work',
    'hire',
    'hiring',
    'collaborate',
    'strength',
    'experience',
    'background',
    'skill',
    'summary',
    'overview',
    'career',
    'recommend',
    'impact',
    'expertise',
    'specialty',
    'good',
    'best',
  ].map(stem),
);

/**
 * Whether a question is asking for the through-line rather than a specific
 * story.
 *
 * @param {string} question
 * @returns {boolean}
 */
export function isOverviewQuestion(question) {
  for (const term of stems(question)) {
    if (OVERVIEW_TERMS.has(term)) return true;
  }
  return false;
}

/**
 * Entries that best represent the body of work, for an overview question.
 *
 * Ranked by how often each entry's tags recur across the whole corpus, so the
 * stories carrying the recurring themes rise. This is the honest reading of
 * "what characterises this work" from data already curated by hand, and it
 * needs no separate featured list to drift out of sync with the content.
 *
 * @param {Array<{id: string, data: Record<string, unknown>}>} entries
 * @param {number} limit
 */
function overviewSelection(entries, limit) {
  const frequency = new Map();
  for (const entry of entries) {
    for (const tag of Array.isArray(entry.data?.tags) ? entry.data.tags : []) {
      frequency.set(tag, (frequency.get(tag) ?? 0) + 1);
    }
  }

  return (
    entries
      .map((entry) => {
        const tags = Array.isArray(entry.data?.tags) ? entry.data.tags : [];
        return {
          id: entry.id,
          score: tags.reduce(
            (total, tag) => total + (frequency.get(tag) ?? 0),
            0,
          ),
          data: entry.data,
        };
      })
      // An entry with no tags tells us nothing about the through-line.
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, limit)
  );
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

  const matched = entries
    .map((entry) => ({
      id: entry.id,
      score: scoreEntry(question, entry.data),
      data: entry.data,
    }))
    .filter((entry) => entry.score >= floor)
    // Tie-break on id so identical scores produce a stable order. Without
    // this the same question can retrieve a different set between requests,
    // which makes drift evals report noise as regression.
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  if (matched.length > 0) return matched.slice(0, limit);

  // Nothing matched lexically. Only now consider whether the question was
  // asking about the work as a whole — checked last, so it can never widen
  // what a question that *did* match is allowed to see.
  return isOverviewQuestion(question) ? overviewSelection(entries, limit) : [];
}
