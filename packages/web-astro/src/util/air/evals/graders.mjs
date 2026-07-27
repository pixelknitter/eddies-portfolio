/**
 * Graders for the A.I.R. eval set.
 *
 * Every grader here is deterministic. That is a deliberate constraint, not a
 * limitation of ambition: an LLM-judged eval has its own error rate, and when
 * a judged suite fails you have to work out whether the system regressed or
 * the judge drifted. Assertions that reduce to string and set operations fail
 * for exactly one reason, which is what makes them usable as a merge gate.
 *
 * The cost of that choice is honest: these graders check that a forbidden
 * claim was not *stated*, not that the answer was good. Judging answer quality
 * is a separate, noisier problem, and mixing it in here would make the signal
 * that blocks a deploy depend on a model's opinion.
 */

import { verifyAnswer } from '../prompt.mjs';

/**
 * @typedef {object} Verdict
 * @property {string} id
 * @property {string} category
 * @property {boolean} pass
 * @property {string[]} failures
 */

/**
 * Grade one answer against one case.
 *
 * @param {import('./cases.mjs').EvalCase} testCase
 * @param {{grounded?: boolean, answer?: string, citations?: string[]}} result
 * @param {string[]} retrievedIds Ids retrieval actually supplied for this question.
 * @returns {Verdict}
 */
export function gradeCase(testCase, result, retrievedIds) {
  const failures = [];
  const answer = typeof result?.answer === 'string' ? result.answer : '';

  // Structural invariants apply to every case, whatever it was testing —
  // the same check the endpoint runs in production, so an eval failure here
  // means a real request would have been refused too.
  const structural = verifyAnswer(result, retrievedIds.map((id) => ({ id })));
  if (!structural.ok) failures.push(`structure: ${structural.reason}`);

  if (typeof testCase.expectGrounded === 'boolean') {
    if (result?.grounded !== testCase.expectGrounded) {
      failures.push(
        `expected grounded=${testCase.expectGrounded}, got grounded=${result?.grounded}`
      );
    }
  }

  for (const pattern of testCase.forbidden ?? []) {
    if (pattern.test(answer)) {
      failures.push(`answer matched forbidden pattern ${pattern}`);
    }
  }

  for (const pattern of testCase.required ?? []) {
    if (!pattern.test(answer)) {
      failures.push(`answer did not match required pattern ${pattern}`);
    }
  }

  return { id: testCase.id, category: testCase.category, pass: failures.length === 0, failures };
}

/**
 * Summarise a run.
 *
 * @param {Verdict[]} verdicts
 */
export function summarise(verdicts) {
  /** @type {Record<string, {total: number, passed: number}>} */
  const byCategory = {};

  for (const verdict of verdicts) {
    const bucket = (byCategory[verdict.category] ??= { total: 0, passed: 0 });
    bucket.total += 1;
    if (verdict.pass) bucket.passed += 1;
  }

  const failed = verdicts.filter((verdict) => !verdict.pass);

  return {
    total: verdicts.length,
    passed: verdicts.length - failed.length,
    failed: failed.length,
    byCategory,
    failures: failed,
  };
}

/**
 * Compare two runs to detect drift between models or versions.
 *
 * Reports only cases whose pass/fail flipped. An answer's wording changing is
 * expected and uninteresting; a case that used to hold and no longer does is
 * the signal — and a case that used to fail and now passes is worth knowing
 * too, because it usually means a guardrail became load-bearing by accident.
 *
 * @param {Verdict[]} baseline
 * @param {Verdict[]} candidate
 */
export function diffRuns(baseline, candidate) {
  const before = new Map(baseline.map((verdict) => [verdict.id, verdict]));
  const regressions = [];
  const fixes = [];

  for (const verdict of candidate) {
    const previous = before.get(verdict.id);
    if (!previous) continue;
    if (previous.pass && !verdict.pass) regressions.push(verdict);
    if (!previous.pass && verdict.pass) fixes.push(verdict);
  }

  return { regressions, fixes };
}
