import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { loadEvalCorpus } from './corpus.mjs';
import { selectContext } from '../retrieval.mjs';
import { CASES, casesIn } from './cases.mjs';
import { SUGGESTED, suggestionSentence } from '../suggested.mjs';
import { gradeCase, summarise, diffRuns } from './graders.mjs';

/**
 * The offline half of the A.I.R. eval suite.
 *
 * A large share of the boundary guarantee is decided by retrieval, not by the
 * model: when nothing clears the relevance floor the endpoint declines without
 * making a request at all. That part is deterministic, costs nothing, and
 * needs no API key — so it runs in CI on every pull request, while the live
 * suite (scripts/air-eval.mjs) runs against the real model on demand.
 *
 * This is the gate that catches the two ways the corpus itself breaks the
 * guardrails: content that makes an out-of-scope question retrievable, and a
 * retrieval change that leaves real questions with nothing to answer from.
 */

/**
 * Resolve the content directory from the working directory rather than from
 * `import.meta.url` — under the vitest transform that is not a file:// URL,
 * so URL-relative resolution silently produces a root-absolute path.
 */
function contentRoot(): string {
  const candidates = [
    join(process.cwd(), 'src/content'),
    join(process.cwd(), 'packages/web-astro/src/content'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found)
    throw new Error(
      `content directory not found; looked in ${candidates.join(', ')}`,
    );
  return found;
}

const CONTENT_ROOT = contentRoot();

// Drafts are included deliberately: review tiers retrieve them, so they are
// part of what the guardrails have to hold against.
//
// The loader is shared with scripts/air-eval.mjs and mirrors what ask.ts reads.
// This file used to build its own corpus from a flat readdirSync over `star` and
// `projects`, which silently excluded the entire resume collection — see the
// header of corpus.mjs.
const corpus = loadEvalCorpus(CONTENT_ROOT);

/**
 * Whether there is a real corpus to grade. False on a build with no seal key —
 * a fork pull request, or any job that runs the tests before unsealing.
 */
const hasRealStories = corpus.length > 0;

describe('A.I.R. corpus', () => {
  it.skipIf(!hasRealStories)('has stories to answer from', () => {
    expect(corpus.length).toBeGreaterThan(0);
  });
});

describe('boundary cases decline without a model call', () => {
  // Every boundary case that expects a decline must reach that decline through
  // retrieval returning nothing. If one of these starts retrieving context, the
  // guarantee quietly downgrades from "structurally impossible to answer" to
  // "the prompt asked it not to" — which is a much weaker promise.
  for (const testCase of casesIn('boundary').filter(
    (c) => c.expectGrounded === false,
  )) {
    it.skipIf(!hasRealStories)(`${testCase.id} — ${testCase.why}`, () => {
      expect(selectContext(testCase.question, corpus)).toEqual([]);
    });
  }
});

describe('grounding cases have something to answer from', () => {
  // The counterweight to every test above. Guardrails tightened until the
  // system declines everything would pass the entire boundary suite and be
  // worthless, so these assert the opposite direction.
  //
  // Skipped while the corpus is still placeholder — asserting them against
  // SAMPLE fixtures would only prove the fixtures match the fixtures. The
  // moment a real story lands these arm themselves, and a suggested question
  // with nothing behind it fails the build.
  for (const testCase of casesIn('grounding')) {
    it.skipIf(!hasRealStories)(`${testCase.id} retrieves context`, () => {
      expect(
        selectContext(testCase.question, corpus).length,
        `No story answers "${testCase.question}". Either add one or change the suggested question.`,
      ).toBeGreaterThan(0);
    });
  }

  it('reports whether a real corpus was found', () => {
    if (hasRealStories) {
      expect(corpus.length).toBeGreaterThan(0);
      return;
    }

    // Deliberately no assertion: with no seal key there is legitimately nothing
    // to grade, and failing here would block a fork pull request over content it
    // cannot read. The warning names the likely cause, because the silent
    // version of this — every eval skipping unnoticed — is how a broken
    // guardrail reaches a deploy.
    console.warn(
      '[air] no real content on disk in star, projects or resume — every A.I.R. ' +
        'eval was skipped. If this is CI or a deploy, the job is running tests ' +
        'before `seal-content.mjs unseal-all`.',
    );
  });
});

describe('graders', () => {
  const supplied = ['platform-migration'];

  it('passes a well-formed grounded answer', () => {
    const verdict = gradeCase(
      {
        id: 'x',
        category: 'grounding',
        question: 'q',
        why: '',
        expectGrounded: true,
      },
      { grounded: true, answer: 'He built a smoke test.', citations: supplied },
      supplied,
    );
    expect(verdict.pass).toBe(true);
  });

  it('fails an answer citing a story retrieval never supplied', () => {
    const verdict = gradeCase(
      { id: 'x', category: 'grounding', question: 'q', why: '' },
      {
        grounded: true,
        answer: 'He led the Acme rewrite.',
        citations: ['acme'],
      },
      supplied,
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.failures.join(' ')).toContain('acme');
  });

  it('fails an answer matching a forbidden pattern', () => {
    const verdict = gradeCase(
      {
        id: 'x',
        category: 'security',
        question: 'q',
        why: '',
        forbidden: [/\bmatey\b/i],
      },
      { grounded: false, answer: 'Arr, matey!', citations: [] },
      supplied,
    );
    expect(verdict.pass).toBe(false);
  });

  it('fails when grounding does not match the expectation', () => {
    const verdict = gradeCase(
      {
        id: 'x',
        category: 'boundary',
        question: 'q',
        why: '',
        expectGrounded: false,
      },
      { grounded: true, answer: 'He worked at Google.', citations: supplied },
      supplied,
    );
    expect(verdict.pass).toBe(false);
  });

  it('summarises per category', () => {
    const summary = summarise([
      { id: 'a', category: 'boundary', pass: true, failures: [] },
      { id: 'b', category: 'boundary', pass: false, failures: ['nope'] },
      { id: 'c', category: 'security', pass: true, failures: [] },
    ]);
    expect(summary).toMatchObject({ total: 3, passed: 2, failed: 1 });
    expect(summary.byCategory.boundary).toEqual({ total: 2, passed: 1 });
  });

  it('reports only flipped cases as drift', () => {
    const baseline = [
      { id: 'a', category: 'boundary', pass: true, failures: [] },
      { id: 'b', category: 'security', pass: false, failures: ['x'] },
      { id: 'c', category: 'conduct', pass: true, failures: [] },
    ];
    const candidate = [
      { id: 'a', category: 'boundary', pass: false, failures: ['regressed'] },
      { id: 'b', category: 'security', pass: true, failures: [] },
      { id: 'c', category: 'conduct', pass: true, failures: [] },
    ];

    const { regressions, fixes } = diffRuns(baseline, candidate);
    expect(regressions.map((v) => v.id)).toEqual(['a']);
    expect(fixes.map((v) => v.id)).toEqual(['b']);
  });
});

describe('eval set', () => {
  it('covers every guardrail category', () => {
    const categories = new Set(CASES.map((testCase) => testCase.category));
    expect(categories).toEqual(
      new Set(['boundary', 'security', 'conduct', 'grounding']),
    );
  });

  it('gives every case a stated reason for existing', () => {
    for (const testCase of CASES) {
      expect(testCase.why, `${testCase.id} has no rationale`).toBeTruthy();
    }
  });
});

/**
 * The suggestions are a promise made on the page itself: three buttons a
 * visitor is invited to press. One of them shipped pointing at a question the
 * corpus could not answer, so pressing it produced "that isn't something
 * Eddie's written work covers" — and the decline then suggested the same
 * question back, because that sentence was a separate hand-written copy of this
 * list. Nothing failed; nothing was watching.
 */
describe('suggested questions', () => {
  for (const item of SUGGESTED) {
    it.skipIf(!hasRealStories)(
      `${item.audience}: "${item.question}" retrieves context`,
      () => {
        expect(
          selectContext(item.question, corpus).length,
          `The page offers this question but nothing answers it. Reword it, or add a story.`,
        ).toBeGreaterThan(0);
      },
    );
  }

  it('the decline message only names questions that work', () => {
    // The sentence is built from SUGGESTED, so this holds by construction — the
    // test guards the construction, not the copy. Quoted verbatim, because
    // lowercasing a question to fit "try asking about …" produced "how does
    // Eddie approach…", which keeps the inverted word order of a question.
    const sentence = suggestionSentence();
    for (const item of SUGGESTED.slice(0, 2)) {
      expect(sentence).toContain(item.question);
    }
  });
});
