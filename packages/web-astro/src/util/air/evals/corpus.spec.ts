import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadEvalCorpus } from './corpus.mjs';

/**
 * The eval corpus loader.
 *
 * This exists because the harness had drifted from the endpoint. `ask.ts` reads
 * three collections — `star`, `projects` and `resume` — while both eval layers
 * read two, with a non-recursive `readdirSync` that could not have found the
 * resume even if it had been named. The resume landed nested (`experience/`,
 * `education/`, …) and the drift was silent: the suite reported "no real STAR
 * stories on disk" and skipped every case while real, answerable resume content
 * sat one directory down.
 *
 * So the loader is tested against a temporary tree rather than the real content
 * directory. Real resume content lives in gitignored `.local-*` directories, so
 * a test that asserted against it would pass on Eddie's machine and skip in CI —
 * which is the exact failure mode being fixed here.
 */

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'air-corpus-'));

  const write = (relative: string, body: string) => {
    const path = join(root, relative);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, body);
  };

  write(
    'star/platform-migration.md',
    '---\ntitle: Platform migration\n---\nNever claim it guaranteed compliance.\n',
  );
  write('star/_template.md', '---\ntitle: Template\n---\nPlaceholder.\n');
  write('star/sample-team-growth.md', '---\ntitle: Sample\n---\nFixture.\n');

  write(
    'projects/curlfriend.md',
    '---\ntitle: Curlfriend\n---\nA project write-up.\n',
  );

  write(
    'challenges/underestimated-migration.md',
    '---\ntitle: A migration I sized wrong\n---\nThe estimate was the mistake, not the migration.\n',
  );

  // Nested, the way the resume collection actually is on disk.
  write(
    'resume/experience/frontdoor-streem.md',
    '---\ntitle: Staff Engineer, Frontdoor\n---\nLed the Streem integration.\n',
  );
  write(
    'resume/skills/skills.md',
    '---\ntitle: Skills\n---\nTypeScript, Swift, Kotlin.\n',
  );

  write(
    'blog/smoke-tests.md',
    "---\ntitle: Why smoke tests\nblurb: Status checks lie.\ndraft: false\n---\nThe post body.\n",
  );
  write(
    'blog/not-yet.md',
    "---\ntitle: Not yet\ndraft: false\npublishDate: 2099-01-01T00:00:00Z\n---\nUnpublished.\n",
  );
  write(
    'blog/in-progress.md',
    "---\ntitle: In progress\ndraft: true\n---\nStill writing.\n",
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('loadEvalCorpus', () => {
  it('includes the resume collection the endpoint serves', () => {
    const ids = loadEvalCorpus(root).map((entry) => entry.id);

    expect(ids).toContain('resume/experience/frontdoor-streem');
  });

  it('recurses into subdirectories, matching the production glob', () => {
    const ids = loadEvalCorpus(root).map((entry) => entry.id);

    // `**/[!_]*.md` in content.config.ts is recursive. A flat readdirSync is
    // what hid the whole resume collection from the harness.
    expect(ids).toContain('resume/skills/skills');
  });

  it('labels a STAR body as constraints and a project body as content', () => {
    const corpus = loadEvalCorpus(root);

    const story = corpus.find((entry) => entry.id === 'platform-migration');
    const project = corpus.find((entry) => entry.id === 'curlfriend');

    // ask.ts draws this distinction because the two collections mean opposite
    // things by "body": a STAR body is an instruction about how a claim may be
    // phrased, a project body is narrative. Getting it wrong here would grade a
    // prompt the site does not build.
    expect(story?.constraints).toBe(
      'Never claim it guaranteed compliance.',
    );
    expect(project?.content).toBe('A project write-up.');
  });

  it('includes the challenges collection, which only A.I.R. reads', () => {
    const entry = loadEvalCorpus(root).find(
      (item) => item.id === 'challenges/underestimated-migration',
    );

    // Namespaced like the resume so a citation names the collection it came
    // from — these carry a different weight from a highlight, and an answer
    // that cites one should be traceable to it.
    expect(entry).toBeDefined();
    // A challenge body is narrative, not an honesty guardrail.
    expect(entry?.content).toBe('The estimate was the mistake, not the migration.');
  });

  it('labels a resume body as content, not constraints', () => {
    const entry = loadEvalCorpus(root).find(
      (item) => item.id === 'resume/experience/frontdoor-streem',
    );

    expect(entry?.content).toBe('Led the Streem integration.');
    expect(entry?.constraints).toBeUndefined();
  });

  it('excludes templates and fixtures, which no visitor is served', () => {
    const ids = loadEvalCorpus(root).map((entry) => entry.id);

    expect(ids).not.toContain('_template');
    expect(ids).not.toContain('sample-team-growth');
  });

  it('returns an empty corpus rather than throwing on a missing collection', () => {
    const empty = mkdtempSync(join(tmpdir(), 'air-corpus-empty-'));
    try {
      // A fork PR has no seal key and so no content at all. That must skip the
      // evals, not crash the suite.
      expect(loadEvalCorpus(empty)).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('loadEvalCorpus and the blog', () => {
  it('grades published posts, which the endpoint now answers from', () => {
    const ids = loadEvalCorpus(root).map((entry) => entry.id);

    expect(ids).toContain('blog/smoke-tests');
  });

  it('excludes a scheduled post the site itself would not serve', () => {
    const ids = loadEvalCorpus(root).map((entry) => entry.id);

    // Grading a post that is not live would score the harness against an
    // answer production cannot give — and would reward leaking it early.
    expect(ids).not.toContain('blog/not-yet');
    expect(ids).not.toContain('blog/in-progress');
  });

  it('mirrors a blurb to summary so retrieval indexes it', () => {
    const entry = loadEvalCorpus(root).find(
      (item) => item.id === 'blog/smoke-tests',
    );

    expect(entry?.data.summary).toBe('Status checks lie.');
  });
});
