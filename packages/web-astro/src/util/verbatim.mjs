/**
 * Does a commit message reproduce sealed content?
 *
 * ## The failure this exists for
 *
 * The vault's threat model is "the repo is public". Sealing a file and then
 * describing its contents in the commit that seals it is a guard defeated by
 * its own paperwork — and it is worse than committing the plaintext, because a
 * file can be removed in the next commit and a message cannot be removed at
 * all. GitHub retains the commits of a merged pull request permanently, branch
 * deletion included.
 *
 * This was not hypothetical. PR #93 quoted resume prose, hard metrics, an NDA
 * reference and a health disclosure the content had deliberately removed.
 *
 * ## Why verbatim runs, and not a word list
 *
 * A blocklist of sensitive terms has to be maintained by hand and is wrong the
 * moment content changes. An n-word run shared with the sealed plaintext needs
 * no maintenance: it is derived from whatever the vault currently holds, so it
 * tracks the content automatically.
 *
 * It catches quotation, which is the realistic mistake. It does not catch
 * deliberate paraphrase, and is not meant to — that is what the written rule is
 * for. A guard that stops the accident is worth having even though a determined
 * author can write around it.
 *
 * ## Choosing n
 *
 * Long enough that ordinary prose does not collide, short enough to catch a
 * lifted phrase. `WINDOW` is the measured default — see its comment.
 *
 * Corpus-as-argument, like `contentFingerprint`: reading the plaintext needs
 * the seal key, and keeping the key out of here leaves the logic pure and
 * testable without a vault.
 */

/**
 * The default run length, chosen by measurement rather than taste.
 *
 * Tuned against this repo's own history: every commit message on `master` was
 * scored against the sealed corpus, and 5 is the smallest window with no false
 * positive on messages that describe code. Below that, ordinary English
 * ("and the rest of the") starts colliding with prose.
 */
export const WINDOW = 5;

/**
 * Text → comparable words.
 *
 * Markdown emphasis is stripped rather than treated as a character, or
 * `**damped-trend**` in a bullet would not match `damped-trend` in a message —
 * which is exactly how prose gets quoted out of content files.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function normalise(text) {
  return (
    text
      .toLowerCase()
      // Emphasis, code fences and inline code carry no meaning for this
      // comparison and would otherwise split or glue words.
      .replace(/[*_`~]/g, '')
      // Anything that is not a letter, digit or intra-word apostrophe becomes a
      // boundary. Em-dashes especially: content prose is full of them, and
      // gluing the words either side would hide a quoted run that spans one.
      .replace(/[^\p{L}\p{N}']+/gu, ' ')
      .split(' ')
      .filter(Boolean)
  );
}

/**
 * Function words, which carry no evidence of quotation.
 *
 * Not a security list and not exhaustive on purpose — it only has to be good
 * enough to tell "at all that is the" from "damped trend revenue projections".
 */
const COMMON = new Set(
  ('a an and are as at be been but by can did do does for from had has have he her his i if in is it its me my no not of on or our out she so than that the their them then there these they this to up us was we were what when which who will with would you your all also any because been before both each how into just more most no now only other over same some such take then thing time up very way well were will'
  ).split(' '),
);

/**
 * Is this run evidence of quotation, or just English?
 *
 * Measured, not assumed: at a 5-word window, three of the six flagged
 * vault-touching commits in this repo's history matched on runs made entirely
 * of function words. Requiring two content-bearing words removed all three and
 * lost no real quotation — real quotations carry nouns.
 *
 * Two rather than one: a single distinctive word surrounded by function words
 * ("is the vertical with the") is how every false positive presented.
 *
 * @param {string[]} words
 */
function distinctive(words) {
  return words.filter((word) => !COMMON.has(word)).length >= 2;
}

/**
 * @param {string[]} words
 * @param {number} n
 * @returns {string[]} Every n-word run, space-joined.
 */
function runs(words, n) {
  const out = [];
  for (let i = 0; i + n <= words.length; i += 1) {
    out.push(words.slice(i, i + n).join(' '));
  }
  return out;
}

/**
 * The first run of `n` words the message shares with the corpus.
 *
 * Returns the run itself rather than a boolean so the caller can quote it back
 * — an error that says *which* phrase to remove is actionable, one that says
 * "something matched" sends you hunting through your own message.
 *
 * @param {string} message
 * @param {string[]} corpus Plaintext of the sealed files.
 * @param {number} [n]
 * @returns {string | null}
 */
export function findVerbatim(message, corpus, n = WINDOW) {
  const haystack = new Set();
  for (const text of corpus) {
    for (const run of runs(normalise(text), n)) haystack.add(run);
  }
  if (haystack.size === 0) return null;

  for (const run of runs(normalise(message), n)) {
    // Distinctiveness is checked on the message side only. The run is the same
    // either way, and checking once keeps building the corpus cheap.
    if (haystack.has(run) && distinctive(run.split(' '))) return run;
  }
  return null;
}
