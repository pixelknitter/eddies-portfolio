/**
 * Which committed files the leak audit is responsible for.
 *
 * The audit's rule is narrow and absolute: unpublished content must never sit
 * in the git index as plaintext, because this repo is public and history cannot
 * be un-published. Everything this predicate excludes is therefore *unguarded*,
 * which makes the exclusion list a security boundary rather than a tidiness
 * convenience — and the reason it lives here, tested, instead of inline as a
 * filter expression.
 *
 * ## Why not "any file starting with an underscore"
 *
 * That was the rule, and it is an unbounded implicit allowlist: `_notes.md`,
 * `_draft-ideas.md` or `_scratch.md` bypassed the leak audit silently, with
 * nothing to notice. It was found by accident — a probe named `_probe.md`
 * sailed through a guard that should have caught it.
 *
 * The underscore convention comes from Astro, where it means "partial, never
 * served". But being *served* was never the threat this audit addresses. Being
 * committed to a public repository is, and an unserved file is just as readable
 * on GitHub as a served one.
 *
 * Fifteen lines from where that filter lived, the explicit exemption set says
 * "Keep this list at one entry. A second exemption is a sign the rule is being
 * worked around." The prefix rule quietly contradicted it.
 *
 * ## Why `_template.md` keeps its exemption
 *
 * Every collection has one, all four are `draft: true`, and they hold
 * placeholder prose that demonstrates the frontmatter shape. Sealing them would
 * leave a fork unable to see how to write an entry, which is the same reasoning
 * that exempts the scheduled-post fixture. The exemption is now the exact
 * basename, in the exact place it is expected, rather than a prefix anyone can
 * reach for.
 */

/** The one underscore file the audit skips, and only directly in a collection. */
const TEMPLATE = '_template.md';

/**
 * The audit's root. Depth is derived from it rather than written as a number,
 * because a hand-counted depth is exactly the kind of thing that is wrong once
 * and then silently wrong forever.
 */
const CONTENT_ROOT = 'packages/web-astro/src/content';
const CONTENT_ROOT_DEPTH = CONTENT_ROOT.split('/').length;

/**
 * @param {string} path Repo-relative, e.g. `packages/web-astro/src/content/star/x.md`
 * @returns {boolean} Whether the leak audit must judge this file.
 */
export function auditsAsContent(path) {
  if (!path.endsWith('.md')) return false;

  const segments = path.split('/');
  const name = segments[segments.length - 1];
  if (name !== TEMPLATE) return true;

  // A template earns its exemption by being the per-collection stub — one
  // directory below the content root. `star/archive/_template.md` is someone
  // else's file that happens to share a name, and stays audited.
  return segments.length !== CONTENT_ROOT_DEPTH + 2;
}
