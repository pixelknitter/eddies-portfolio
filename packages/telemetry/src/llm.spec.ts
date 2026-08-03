import { describe, it, expect } from 'vitest';

import { OUTCOMES, buildTrace, buildRetrievalSpan, buildGeneration } from './llm.mjs';

describe('OUTCOMES', () => {
  it('is the closed set every exit from the endpoint classifies into', () => {
    // A stray value in production means a code path exits without classifying
    // itself — the exact blind spot this instrumentation exists to remove.
    expect([...OUTCOMES].sort()).toEqual(
      [
        'answered',
        'misconfigured',
        'no_context',
        'rate_limited',
        'refusal',
        'truncated',
        'unauthorised',
        'unparseable',
        'upstream_error',
        'verification_failed',
      ].sort(),
    );
  });
});

describe('buildTrace', () => {
  it('carries the outcome and the release marker', () => {
    const { event, properties } = buildTrace({
      traceId: 't-1',
      outcome: 'answered',
      tier: 'staging',
      buildSha: 'abc123',
      grounded: true,
      questionLength: 42,
      grantType: 'personal',
      fromSuggestion: false,
    });

    expect(event).toBe('$ai_trace');
    expect(properties.$ai_trace_id).toBe('t-1');
    expect(properties.outcome).toBe('answered');
    expect(properties.build_sha).toBe('abc123');
    // grant_type answers "are approved people actually using it" without
    // saying whose — the useful half of identity with none of the exposure.
    expect(properties.grant_type).toBe('personal');
  });

  it('records the question length but never the question', () => {
    const { properties } = buildTrace({
      traceId: 't-1',
      outcome: 'no_context',
      questionLength: 42,
    });

    expect(properties.question_length).toBe(42);
    expect(JSON.stringify(properties)).not.toContain('question"');
  });
});

describe('buildRetrievalSpan', () => {
  it('exists even when no generation happened', () => {
    // The load-bearing detail: on the no_context path the endpoint declines
    // without calling the model. Without this span every unanswerable question
    // would be invisible, and "% answered" is generations over traces — which
    // is only correct because the trace and span exist in both cases.
    const { event, properties } = buildRetrievalSpan({
      traceId: 't-1',
      retrievedIds: [],
      topScore: 0,
      floorCleared: false,
    });

    expect(event).toBe('$ai_span');
    expect(properties.$ai_trace_id).toBe('t-1');
    expect(properties.retrieved_count).toBe(0);
    expect(properties.floor_cleared).toBe(false);
  });

  it('reports what retrieval supplied', () => {
    const { properties } = buildRetrievalSpan({
      traceId: 't-1',
      retrievedIds: ['platform-migration', 'resume/experience/a'],
      topScore: 0.82,
      floorCleared: true,
    });

    expect(properties.retrieved_count).toBe(2);
    expect(properties.retrieved_ids).toEqual([
      'platform-migration',
      'resume/experience/a',
    ]);
  });
});

describe('buildGeneration', () => {
  const usage = {
    input_tokens: 1200,
    output_tokens: 180,
    cache_read_input_tokens: 900,
    cache_creation_input_tokens: 0,
  };

  it('reports latency in seconds, which is the unit PostHog expects', () => {
    const { properties } = buildGeneration({
      traceId: 't-1',
      model: 'claude-opus-5',
      ms: 2500,
      usage,
      stopReason: 'end_turn',
    });

    // Sending milliseconds here would make every answer look 1000× slower and
    // would be believed, because nothing else in the payload contradicts it.
    expect(properties.$ai_latency).toBe(2.5);
  });

  it('carries stop_reason, which is the fix for the max_tokens blind spot', () => {
    const { properties } = buildGeneration({
      traceId: 't-1',
      model: 'claude-opus-5',
      ms: 10,
      usage,
      stopReason: 'max_tokens',
    });

    // Today a truncated answer and malformed JSON are indistinguishable.
    expect(properties.stop_reason).toBe('max_tokens');
  });

  it('records cache reads, so the frozen system prompt can be checked', () => {
    const { properties } = buildGeneration({
      traceId: 't-1',
      model: 'claude-opus-5',
      ms: 10,
      usage,
      stopReason: 'end_turn',
    });

    // Nobody has ever verified that SYSTEM_PROMPT actually caches. Zero on a
    // repeated question means a silent invalidator.
    expect(properties.cache_read_input_tokens).toBe(900);
    expect(properties.$ai_input_tokens).toBe(1200);
    expect(properties.$ai_output_tokens).toBe(180);
  });

  it('names the provider and the resolved model, not a constant', () => {
    const { event, properties } = buildGeneration({
      traceId: 't-1',
      model: 'claude-sonnet-5',
      ms: 10,
      usage,
      stopReason: 'end_turn',
    });

    expect(event).toBe('$ai_generation');
    expect(properties.$ai_provider).toBe('anthropic');
    // A trace must be attributable to the config that produced it, which a
    // hardcoded constant would not be once the model flag lands.
    expect(properties.$ai_model).toBe('claude-sonnet-5');
  });

  it('tolerates a usage object missing the cache fields', () => {
    const { properties } = buildGeneration({
      traceId: 't-1',
      model: 'claude-opus-5',
      ms: 10,
      usage: { input_tokens: 10, output_tokens: 2 },
      stopReason: 'end_turn',
    });

    expect(properties.cache_read_input_tokens).toBe(0);
  });
});

describe('a declined retrieval records what was asked', () => {
  /*
   * A decline never calls the model, so no generation exists — which meant the
   * questions the corpus *cannot* reach were the only ones recorded nowhere.
   *
   * On the span it lands in `ai_events`, under the same 30-day content
   * retention as every other question A.I.R. has seen. No new retention
   * category, and the permanent `events` table stays free of anyone's prose.
   * Redaction is the transport's job, applied to the whole batch on the way out.
   */

  it('carries the question when nothing was retrieved', () => {
    const { properties } = buildRetrievalSpan({
      traceId: 't1',
      retrievedIds: [],
      floorCleared: false,
      question: 'How does he handle incidents?',
    });

    expect(properties.question).toBe('How does he handle incidents?');
  });

  it('omits the question when retrieval succeeded', () => {
    // A grounded question already rides on the generation. Recording it here
    // too would write the same content twice for one dataset.
    const { properties } = buildRetrievalSpan({
      traceId: 't1',
      retrievedIds: ['platform-migration'],
      floorCleared: true,
      question: 'How does he handle incidents?',
    });

    expect(properties.question).toBeUndefined();
  });

  it('omits the question when the caller did not supply one', () => {
    const { properties } = buildRetrievalSpan({
      traceId: 't1',
      retrievedIds: [],
      floorCleared: false,
    });

    expect(properties.question).toBeUndefined();
  });
});
