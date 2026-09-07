import { describe, it, expect } from 'vitest';
import { auditsAsContent } from './content-audit.mjs';

/**
 * Which committed files the leak audit is responsible for.
 *
 * The audit's job is narrow and absolute: unpublished content must never sit in
 * the index as plaintext, because this repo is public. Anything it skips is
 * unguarded, so the skip list is the security boundary and deserves its own
 * tests rather than living as a filter expression.
 */
describe('auditsAsContent', () => {
  const p = (name: string) => `packages/web-astro/src/content/${name}`;

  it('audits an ordinary content file', () => {
    expect(auditsAsContent(p('star/a-story.md'))).toBe(true);
  });

  it('ignores non-markdown', () => {
    // Images and data files carry no frontmatter to judge.
    expect(auditsAsContent(p('projects/diagram.webp'))).toBe(false);
    expect(auditsAsContent(p('star/notes.txt'))).toBe(false);
  });

  /**
   * `_template.md` is the one legitimate underscore. Every collection has one,
   * all four are `draft: true`, and they hold placeholder prose — the same
   * reasoning as the explicit exemption for the scheduled-post fixture.
   */
  it('exempts the collection templates', () => {
    for (const c of ['blog', 'star', 'projects', 'challenges']) {
      expect(auditsAsContent(p(`${c}/_template.md`)), c).toBe(false);
    }
  });

  /**
   * The bug this closes. The filter used to skip *any* basename starting with
   * `_`, which is an unbounded implicit allowlist: `_notes.md` bypassed the
   * leak audit silently. Found by a probe named `_probe.md` that sailed through
   * a guard which should have caught it.
   *
   * Underscore means "Astro partial, never served" — but serving was never the
   * threat. Being committed to a public repo is.
   */
  it('audits any other underscore file', () => {
    expect(auditsAsContent(p('star/_notes.md'))).toBe(true);
    expect(auditsAsContent(p('projects/_diagram-inventory.md'))).toBe(true);
    expect(auditsAsContent(p('blog/_draft-ideas.md'))).toBe(true);
  });

  it('does not exempt a template outside a collection directory', () => {
    // `_template.md` earns its exemption by being the per-collection stub, not
    // by its name alone. A nested one is someone else's file.
    expect(auditsAsContent(p('star/archive/_template.md'))).toBe(true);
  });
});
