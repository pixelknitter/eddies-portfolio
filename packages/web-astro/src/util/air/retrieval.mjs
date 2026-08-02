import MiniSearch from 'minisearch';

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
/**
 * Fields offered to the index, and how heavily a hit in each counts.
 *
 * These are relative boosts on top of BM25, not the absolute weights the old
 * scorer used. BM25 already accounts for how rare a term is and how long the
 * field is; a boost only says "a hit here means more than a hit there".
 */
const FIELD_BOOST = {
  title: 3,
  org: 3,
  role: 3,
  tags: 2,
  result: 1.5,
  summary: 1,
  situation: 1,
  task: 1,
  action: 1,
};

const FIELDS = Object.keys(FIELD_BOOST);

/**
 * Flatten an entry into the shape the index reads. Arrays become space-joined
 * text so a tag list is searchable as words.
 *
 * @param {{id: string, data: Record<string, unknown>}} entry
 */
function toDocument(entry) {
  /** @type {Record<string, string>} */
  const doc = { id: entry.id };
  for (const field of FIELDS) {
    const value = entry.data?.[field];
    doc[field] = Array.isArray(value) ? value.join(' ') : String(value ?? '');
  }
  return doc;
}

/** All searchable text of an entry, for document-frequency counting. */
function entryText(entry) {
  return FIELDS.map((field) => {
    const value = entry.data?.[field];
    return Array.isArray(value) ? value.join(' ') : String(value ?? '');
  }).join(' ');
}

/**
 * Below this share of the corpus, a term is treated as distinctive.
 *
 * A term in most documents discriminates nothing — which is exactly what
 * "Eddie" is in a corpus entirely about Eddie. This is IDF expressed as a gate
 * rather than as a weight, and it is why his name never needed adding to
 * STOPWORDS by hand.
 */
const DISTINCTIVE_MAX_SHARE = 0.5;

/**
 * Tokens naming the subject of the corpus, which carry no retrieval signal.
 *
 * **This cannot be derived, and the attempt to derive it is what failed.** The
 * assumption was that IDF would handle it: a name in every document
 * discriminates nothing. In this corpus the opposite is true — stories are
 * titled after the *work* and rarely name him, so "eddie" is *rare*, and
 * therefore scores as maximally distinctive.
 *
 * Frequency cannot express "this token names the subject of everything here".
 * That is a fact about what the corpus is, not about how its words are
 * distributed, so it has to be declared. Every document is about Eddie; naming
 * him narrows nothing.
 *
 * Add a token here only if it identifies the subject. This is not a stopword
 * list — STOPWORDS handles grammatical glue, and the two are not the same idea.
 */
const SUBJECT_TOKENS = new Set(['eddie', 'freeman', 'eddies']);

/**
 * How much of a question's distinctive vocabulary a result must support.
 *
 * **One term. Not a share — a share was tried, and the arithmetic is why it
 * went.** At a half, these two land eight hundredths apart on opposite sides of
 * the decision:
 *
 *     "How quickly can Eddie prove out an MVP?"    mvp          1 of 3 = 0.33
 *     "How many years as a VP of Engineering?"     engineering  1 of 4 = 0.25
 *
 * Weighting by IDF rather than counting makes it worse. A term the corpus has
 * never seen carries the highest IDF there is, so "quickly" and "prove" — absent,
 * and precisely what makes the question look thin — swamp "mvp" and push the
 * matched share down to 0.26. Rarity is the wrong axis: it measures how unusual
 * a word is, not whether anything here answers it.
 *
 * No scalar worked because the gate was answering two questions at once.
 * Retrieval can establish that a *topic* is absent — that is what declines
 * "favourite restaurant in Lisbon", and it does it structurally, without a
 * model call. It cannot establish that a *title is fabricated* when the corpus
 * is full of real titles: from here, "VP of Engineering" and "MVP" are the same
 * shape, one distinctive term with genuine support behind it.
 *
 * So the two jobs are split, and this constant only does the first one. A false
 * premise about a topic the corpus does cover is declined by the answer, which
 * gets the real record and can contradict it — see `declineBy` in
 * evals/cases.mjs, and the premise rule in prompt.mjs.
 */
const MIN_COVERED_TERMS = 1;

/** Below this many documents the share test is meaningless, so skip it. */
const MIN_CORPUS_FOR_SHARE = 3;

/**
 * The words of a question that could make it answerable.
 *
 * A term absent from the corpus is maximally distinctive, and absence is
 * precisely what makes a question unanswerable — so the gate runs on this.
 *
 * @param {string} question
 * @param {Array<{id: string, data: Record<string, unknown>}>} entries
 * @returns {string[]}
 */
/**
 * Tokenise for the coverage gate.
 *
 * Deliberately *not* `terms()`, which drops anything two characters or shorter.
 * That filter is what made `ci-cd` unreachable in the first place, and the gate
 * would reintroduce the bug in a new location: a question about CI/CD would
 * carry no distinctive term and be declined however well it scored.
 *
 * Short tokens need no length filter here, because distinctiveness is decided
 * by document frequency. A noisy two-letter token is either everywhere (and so
 * not distinctive) or matches nothing (and so admits nothing).
 *
 * @param {string} text
 * @returns {string[]}
 */
function gateTerms(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1 && !STOPWORDS.has(term));
}

export function distinctiveTerms(question, entries) {
  const asked = new Set(
    gateTerms(question).filter((term) => !SUBJECT_TOKENS.has(term)),
  );
  if (asked.size === 0) return [];

  const corpus = entries.map((entry) => new Set(gateTerms(entryText(entry))));
  const total = corpus.length;

  return [...asked].filter((term) => {
    const documentFrequency = corpus.filter((doc) => doc.has(term)).length;
    if (documentFrequency === 0) return true;
    if (total < MIN_CORPUS_FOR_SHARE) return true;
    return documentFrequency / total < DISTINCTIVE_MAX_SHARE;
  });
}

/**
 * Select the entries an answer may cite.
 *
 * ## BM25, and the gate that is not a threshold
 *
 * Scoring is BM25 with field boosts, fuzzy and prefix matching — established
 * ranking rather than the hand-tuned weights this used to carry. BM25 brings
 * the idea the old scorer was missing: inverse document frequency. A term in
 * every document contributes almost nothing, which is why the subject's own
 * name can no longer carry a question on its own.
 *
 * Admission is **coverage**, not a score threshold. BM25 scores are unbounded
 * and their scale shifts as content is added, so a fixed floor stops meaning
 * anything; and "did something score highly" was never the question worth
 * asking. The question is whether the *distinctive* words of the question have
 * any support in the corpus. A result is admitted only if the query terms it
 * matched include at least one distinctive term.
 *
 * That keeps the decline structural: when this returns `[]` the model is never
 * called, so the guarantee holds even if the prompt is ignored entirely.
 *
 * @param {string} question
 * @param {Array<{id: string, data: Record<string, unknown>}>} entries
 * @param {{limit?: number}} [options]
 * @returns {Array<{id: string, score: number, data: Record<string, unknown>}>}
 *   Ordered most-relevant first. Empty when nothing is admitted — the caller
 *   must treat that as "decline", not as "answer with no context".
 */
export function selectContext(question, entries, options = {}) {
  const { limit = MAX_ENTRIES } = options;
  if (!entries || entries.length === 0) return [];

  const distinctive = new Set(distinctiveTerms(question, entries));

  /** @type {Array<{id: string, score: number, data: Record<string, unknown>}>} */
  let matched = [];

  if (distinctive.size > 0) {
    const index = new MiniSearch({
      fields: FIELDS,
      storeFields: [],
      idField: 'id',
    });
    index.addAll(entries.map(toDocument));

    const byId = new Map(entries.map((entry) => [entry.id, entry]));

    matched = index
      .search(question, {
        boost: FIELD_BOOST,
        // Light inference: a near-miss spelling still finds the story, without
        // an embedding model or a vector store.
        fuzzy: 0.2,
        prefix: (term) => term.length > 3,
      })
      /*
       * The gate. A result must support something that makes this question
       * specific — never a word the corpus shares with everything, and never a
       * word that merely names the subject, both of which `distinctive` has
       * already removed. BM25 decides ranking; this decides admission.
       */
      .filter((result) => {
        const covered = result.queryTerms.filter(
          (term) => distinctive.has(term) || distinctive.has(stem(term)),
        ).length;
        return covered >= MIN_COVERED_TERMS;
      })
      .map((result) => ({
        id: String(result.id),
        score: result.score,
        data: byId.get(String(result.id))?.data ?? {},
      }))
      // Tie-break on id so identical scores produce a stable order. Without
      // this the same question can retrieve a different set between requests,
      // which makes drift evals report noise as regression.
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  }

  if (matched.length > 0) return matched.slice(0, limit);

  // Nothing matched. Only now consider whether the question was asking about
  // the work as a whole — checked last, so it can never widen what a question
  // that *did* match is allowed to see. An overview question names nothing
  // specific and so has no distinctive terms to cover; this is the path that
  // keeps "Why should I work with Eddie Freeman?" answerable.
  return isOverviewQuestion(question) ? overviewSelection(entries, limit) : [];
}
