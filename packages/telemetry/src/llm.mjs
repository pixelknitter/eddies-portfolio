/**
 * Builders for PostHog's LLM observability events.
 *
 * One HTTP request to `/api/air/ask` is one trace. A.I.R. is single-turn with no
 * conversation state, so trace and request are the same thing:
 *
 *     $ai_trace  (the request)
 *     ├── $ai_span       "retrieval"   — always
 *     └── $ai_generation "answer"      — only if the model was called
 *
 * The retrieval span existing on *every* path is the load-bearing detail. On the
 * `no_context` path the endpoint declines without calling the model at all, so
 * without the span every unanswerable question would be invisible — and that is
 * the second most valuable thing this instrumentation is for. It also means "%
 * of questions answered" is generations over traces, which is only a correct
 * ratio because the trace exists in both cases.
 *
 * `$ai_*` events also land in the `events` table as trimmed copies, so they are
 * queryable as ordinary product analytics. There is deliberately no parallel
 * `air_question_asked` event — that would double the write for one dataset. The
 * trace *is* the event.
 *
 * One consequence worth knowing before anyone concludes capture is broken: the
 * `events` table **never** contains `$ai_input` or `$ai_output_choices`. The
 * large properties live only in `ai_events`, which PostHog deletes after 30
 * days. Metadata — model, tokens, cost, latency, trace ids — persists.
 */

/**
 * Every way a request can end. Closed on purpose: a stray value in production
 * means a code path exits without classifying itself, which is precisely the
 * blind spot this wave exists to remove.
 */
export const OUTCOMES = Object.freeze([
  'answered',
  'no_context',
  'refusal',
  'truncated',
  'unparseable',
  'verification_failed',
  'upstream_error',
  'rate_limited',
  'unauthorised',
  'misconfigured',
]);

/**
 * @param {{
 *   traceId: string,
 *   outcome: string,
 *   tier?: string,
 *   buildSha?: string,
 *   grounded?: boolean,
 *   questionLength?: number,
 *   grantType?: 'shared' | 'personal',
 *   fromSuggestion?: boolean,
 *   model?: string,
 * }} input
 */
export function buildTrace(input) {
  return {
    event: '$ai_trace',
    properties: {
      $ai_trace_id: input.traceId,
      outcome: input.outcome,
      tier: input.tier,
      /*
       * The release marker, and the only reliable way to tell local traffic
       * apart: under `wrangler dev`, `tierFromRequest` reports `production`, so
       * tier alone mislabels. CI sets build_sha and local builds do not —
       * absent build_sha means local.
       */
      build_sha: input.buildSha,
      grounded: input.grounded,
      // The length, never the question. The question rides on the generation,
      // where it is useful for debugging and expires with the ai_events table.
      question_length: input.questionLength,
      grant_type: input.grantType,
      from_suggestion: input.fromSuggestion,
      model: input.model,
    },
  };
}

/**
 * @param {{
 *   traceId: string,
 *   retrievedIds: string[],
 *   topScore?: number,
 *   floorCleared?: boolean,
 *   overviewFallback?: boolean,
 * }} input
 */
export function buildRetrievalSpan(input) {
  return {
    event: '$ai_span',
    properties: {
      $ai_trace_id: input.traceId,
      $ai_span_name: 'retrieval',
      retrieved_count: input.retrievedIds.length,
      // Which stories answered a question is how "what can the corpus not
      // answer" gets answered, and it is also how a retrieval regression is
      // spotted without re-running the eval suite.
      retrieved_ids: input.retrievedIds,
      top_score: input.topScore,
      floor_cleared: input.floorCleared,
      overview_fallback: input.overviewFallback,
    },
  };
}

/**
 * @param {{
 *   traceId: string,
 *   model: string,
 *   ms: number,
 *   usage: {
 *     input_tokens?: number | null,
 *     output_tokens?: number | null,
 *     cache_read_input_tokens?: number | null,
 *     cache_creation_input_tokens?: number | null,
 *   },
 *   stopReason?: string | null,
 *   input?: unknown,
 *   output?: unknown,
 *   citationCount?: number,
 *   verificationReason?: string,
 * }} input
 */
export function buildGeneration(input) {
  const usage = input.usage ?? {};

  return {
    event: '$ai_generation',
    properties: {
      $ai_trace_id: input.traceId,
      // The resolved model, not the hardcoded constant — a trace has to be
      // attributable to the config that produced it.
      $ai_model: input.model,
      $ai_provider: 'anthropic',
      // PostHog's unit here is seconds. Sending milliseconds would make every
      // answer look 1000× slower and would be believed, because nothing else in
      // the payload contradicts it.
      $ai_latency: input.ms / 1000,
      $ai_input_tokens: usage.input_tokens ?? 0,
      $ai_output_tokens: usage.output_tokens ?? 0,
      // Answers "is the frozen system prompt actually caching?" — a question
      // nobody has ever been able to check. Zero on a repeated question means a
      // silent invalidator, and SYSTEM_PROMPT is not buying what it was
      // structured to buy.
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      // The fix for the max_tokens blind spot: today a truncated answer and
      // malformed JSON are one indistinguishable 502.
      stop_reason: input.stopReason,
      $ai_input: input.input,
      $ai_output_choices: input.output,
      citation_count: input.citationCount,
      verification_reason: input.verificationReason,
    },
  };
}
