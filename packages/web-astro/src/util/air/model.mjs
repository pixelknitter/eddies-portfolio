import { readRuntimeVariants } from '../flags/client.mjs';

/**
 * Which model answers, resolved at request time.
 *
 * ## Why this is a flag
 *
 * Comparing models on real traffic needs the model to change without a deploy.
 * The offline eval suite grades guardrail adherence and the live harness grades
 * answers, but neither tells you how a model behaves on the questions actual
 * visitors ask — and swapping a constant, building, and deploying is too slow a
 * loop to do that honestly.
 *
 * Every trace records the model that answered it, so a switch is legible after
 * the fact rather than a mystery in the numbers.
 *
 * ## Why every failure returns the compiled default
 *
 * Same principle as `flags/client.mjs`: a network blip must never change what
 * the site serves. Unconfigured, unreachable, malformed, or a variant of the
 * wrong type all land on `DEFAULT_MODEL` — and only a non-empty string counts,
 * because `true` means "the flag is on", not that the model is named "true".
 */

/** The flag key as it appears in PostHog. */
export const AIR_MODEL_FLAG = 'air-model';

/**
 * What answers when PostHog has no opinion, or cannot be reached.
 *
 * Sonnet rather than Opus. A.I.R. answers two or three short paragraphs from a
 * handful of retrieved stories, bounded at 2000 tokens — a summarising job, not
 * a reasoning one, and the guardrails that matter most are enforced before and
 * after the model rather than by it. Retrieval decides what it may see;
 * `verifyAnswer` checks what it said. Paying Opus rates for the step between
 * them buys little.
 *
 * It is also the *fallback*, which is the case where cost and latency are least
 * supervised: an unreachable PostHog should not silently route every question to
 * the most expensive option.
 *
 * Haiku is the other reasonable answer and is worth trying — `air-model` now
 * makes that a flag flip rather than a deploy, and eval runs emit the same trace
 * shape as production, so the two are directly comparable on real questions.
 * Read boundary and security as "does it stay inside the lines" and grounding as
 * "is it still useful"; a model that declines everything scores perfectly on the
 * first two.
 */
export const DEFAULT_MODEL = 'claude-sonnet-5';

/**
 * @param {Record<string, unknown>} [env]
 * @param {{ now?: number, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<string>}
 */
export async function resolveModel(env = {}, options = {}) {
  const variants = await readRuntimeVariants(env, options);
  const value = variants?.[AIR_MODEL_FLAG];

  return typeof value === 'string' && value.trim() ? value : DEFAULT_MODEL;
}
