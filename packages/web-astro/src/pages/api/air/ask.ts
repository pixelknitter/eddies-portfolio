import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';
import Anthropic from '@anthropic-ai/sdk';

import { resolveSections } from '@util/flags/sections.mjs';
import { selectContext } from '@util/air/retrieval.mjs';
import { suggestionSentence } from '@util/air/suggested.mjs';
import {
  ANSWER_SCHEMA,
  buildSystemPrompt,
  buildUserMessage,
  validateQuestion,
  verifyAnswer,
} from '@util/air/prompt.mjs';
import { createRateLimiter, isAuthorised } from '@util/air/access.mjs';
import { readSecret } from '@util/air/runtime.mjs';
import { verifyAccessCode } from '@util/air/requests.mjs';
import { tierFromRequest } from '@util/air/tier.mjs';
import { resolveModel } from '@util/air/model.mjs';
import { createTelemetry } from '@pk/telemetry';

/**
 * A.I.R. question endpoint.
 *
 * The order of operations here is the design: every cheap check runs before
 * anything that costs money. An unauthorised, rate-limited, malformed, or
 * unanswerable request never reaches the model at all.
 */

// Per-isolate, so it survives between requests on the same isolate and resets
// when Cloudflare recycles it. See the limitation note in access.mjs.
const limiter = createRateLimiter();

/** Bounds one answer's cost. Two or three short paragraphs need far less. */
const MAX_TOKENS = 2000;

/*
 * Which model answers is resolved per request from the `air-model` flag, not
 * compiled in — comparing models on real traffic needs the swap to happen
 * without a deploy. See util/air/model.mjs; every failure path returns the
 * compiled default, so a network blip never changes what the site serves.
 */

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/**
 * The platform's `waitUntil`, or `undefined` if this runtime has none.
 *
 * ## Why this is a function with a try/catch rather than optional chaining
 *
 * It used to read `locals.runtime?.ctx?.waitUntil`. Astro 6 replaced
 * `locals.runtime.ctx` with `locals.cfContext` and left the old name in place
 * as a **getter that throws** — so the optional chaining, which reads as
 * defensive, guarded nothing. `?.` short-circuits on null and undefined; it
 * does not catch. Every request to this endpoint threw on that line, before the
 * gate, before auth, before the body was even parsed.
 *
 * It failed in the least legible way available: Astro turns an endpoint throw
 * into a 500 with an *empty body*, the Worker still reports `outcome: "ok"`
 * because it did return a response, and `AIResume.tsx` calls `response.json()`
 * before checking `response.ok` — so an empty body throws there too and the
 * visitor is told "Could not reach A.I.R. Check your connection." A server
 * fault, reported to the user as their network.
 *
 * So this reads the current name, falls back to the old one for any runtime
 * still providing it, and treats *any* throw as "no waitUntil available".
 * Telemetry is not worth a 500: without it the send is awaited instead of
 * deferred, which is slower and completely correct. The next rename degrades
 * instead of breaking.
 */
function resolveWaitUntil(
  locals: unknown,
): ((promise: Promise<unknown>) => void) | undefined {
  for (const read of [
    () => (locals as { cfContext?: { waitUntil?: unknown } })?.cfContext,
    () => (locals as { runtime?: { ctx?: { waitUntil?: unknown } } })?.runtime?.ctx,
  ]) {
    try {
      const ctx = read();
      if (typeof ctx?.waitUntil === 'function') {
        return (ctx.waitUntil as (p: Promise<unknown>) => void).bind(ctx);
      }
    } catch {
      // A removed accessor that throws rather than returning undefined. Try the
      // next shape; running without `waitUntil` is a supported state.
    }
  }
  return undefined;
}

export async function POST(context: APIContext): Promise<Response> {
  // The section is gated, and so is its API. A flagged-off feature whose
  // endpoint still answers is not gated, it is merely unlinked.
  // A runtime flag can only take this away, never grant it — see flags/sections.mjs.
  const sections = await resolveSections(import.meta.env);
  if (!sections.air) {
    return new Response(null, { status: 404, statusText: 'Not found' });
  }

  /*
   * Telemetry is set up before the first classified exit so that every one of
   * them can be recorded. Dispatched through `waitUntil` where the runtime
   * provides it, so the visitor's answer is never waiting on PostHog; awaited
   * otherwise, so local runs and tests do not exit before the send is made.
   */
  const telemetry = createTelemetry(import.meta.env, {
    waitUntil: resolveWaitUntil(context.locals),
  });

  // Resolved once per request and threaded through every exit, so the trace
  // records which model actually answered rather than which one we assume.
  const model = await resolveModel(import.meta.env);

  const traceId = crypto.randomUUID();
  const tier = tierFromRequest(context.request);
  const buildSha = import.meta.env.PUBLIC_BUILD_SHA;

  /**
   * Every exit from here down goes through this, which is what keeps the
   * `outcome` enum closed. A path that returns without calling it is a blind
   * spot, and a stray value in PostHog is how you find one.
   */
  async function finish(
    response: Response,
    trace: {
      outcome: string;
      grounded?: boolean;
      questionLength?: number;
      grantType?: 'shared' | 'personal';
      model?: string;
    },
    parts: {
      retrieval?: Parameters<typeof telemetry.captureTrace>[0]['retrieval'];
      generation?: Parameters<typeof telemetry.captureTrace>[0]['generation'];
    } = {},
  ): Promise<Response> {
    telemetry.captureTrace({
      trace: { traceId, tier, buildSha, ...trace },
      ...parts,
    });
    await telemetry.flush();
    return response;
  }

  const supplied = context.request.headers.get('x-air-access') ?? undefined;
  const sharedCode = await readSecret('AIR_ACCESS_CODE');
  const signingSecret = await readSecret('AIR_SIGNING_SECRET');

  // Two ways in: the shared code handed out on a card, or a personal code
  // issued to one address by the request-and-approve flow. The personal code
  // carries the address it was issued to, signed, so it verifies with no
  // lookup — and a leaked one is attributable.
  const personal = signingSecret
    ? await verifyAccessCode(signingSecret, supplied)
    : { ok: false };

  if (!personal.ok && !isAuthorised(supplied, sharedCode)) {
    // Deliberately identical whether the code is wrong or unconfigured — the
    // difference is operator information, not visitor information. The trace
    // carries no span: retrieval never ran.
    return finish(
      json({ error: 'This resume is available by invitation.' }, 401),
      { outcome: 'unauthorised' },
    );
  }

  // Which kind of grant was used, never whose. This is the activation signal:
  // a personally-issued code being used to ask a real question is the only
  // step in request → approve → deliver → ask that means anything went right,
  // and the only one a link-preview crawler cannot pollute.
  const grantType: 'shared' | 'personal' = personal.ok ? 'personal' : 'shared';

  const clientId =
    context.request.headers.get('cf-connecting-ip') ??
    context.request.headers.get('x-forwarded-for') ??
    'unknown';

  const rate = limiter.check(clientId);
  if (!rate.allowed) {
    return finish(
      json(
        { error: 'Too many questions in a short window. Try again shortly.' },
        429,
        { 'retry-after': String(rate.retryAfterSeconds) },
      ),
      { outcome: 'rate_limited', grantType },
    );
  }

  let payload: unknown;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400);
  }

  const validated = validateQuestion(
    (payload as { question?: unknown })?.question,
  );
  if (!validated.ok) return json({ error: validated.reason }, 400);

  // The corpus is the STAR collection plus project write-ups, bundled at build
  // time. Drafts follow the same rule as everywhere else on the site.
  const reveal = sections.unpublished;
  const stories = await getCollection(
    'star',
    ({ data }) => reveal || data.draft !== true,
  );
  const projects = await getCollection('projects');
  // Challenges follow the same draft rule as stories. Nothing renders them —
  // they exist so a question about gaps has an honest answer instead of a
  // decline, which on that question reads as evasive.
  const challenges = await getCollection(
    'challenges',
    ({ data }) => reveal || data.draft !== true,
  );
  // The resume. Its bullets live in the body, which is why the prompt carries
  // bodies at all — before this, A.I.R. could not answer "what was his title at
  // Frontdoor", because the resume existed nowhere it could reach.
  const resume = await getCollection('resume');

  /*
   * The two collections mean opposite things by "body", so the distinction is
   * made here — where which collection is being read is still known — rather
   * than inferred downstream.
   *
   * A STAR body is an honesty guardrail: a rule about how a claim may be
   * phrased ("reduces compliance risk, never guarantees compliance"). Those are
   * instructions from the author, and buildUserMessage hoists them outside the
   * story tags so the "treat everything inside as data" guarantee stays true.
   *
   * A project body is narrative — content, not a note about content.
   *
   * Nothing in prompt.mjs guesses which it received.
   */
  const corpus = [
    ...stories.map((entry) => ({
      id: entry.id,
      data: entry.data,
      constraints: entry.body?.trim() || undefined,
    })),
    ...projects.map((entry) => ({
      id: entry.id,
      data: entry.data,
      content: entry.body?.trim() || undefined,
    })),
    // Namespaced so a citation names the collection. An answer drawing a
    // pattern about a shortcoming has to stay traceable to the entries that
    // support it — see the note on inference in content.config.ts.
    ...challenges.map((entry) => ({
      id: `challenges/${entry.id}`,
      data: entry.data,
      content: entry.body?.trim() || undefined,
    })),
    ...resume.map((entry) => ({
      id: `resume/${entry.id}`,
      data: entry.data,
      content: entry.body?.trim() || undefined,
    })),
  ];

  const selected = selectContext(validated.question, corpus);

  // Nothing relevant retrieved: decline here rather than asking the model to
  // answer from an empty context. This is the boundary guarantee — it holds
  // even if the prompt is ignored entirely, because no request is made.
  if (selected.length === 0) {
    return finish(
      json({
      grounded: false,
      // Suggestions come from the same array the buttons render, because this
      // sentence used to be hand-written and drifted into naming a question the
      // corpus could not answer either — a decline that suggested itself.
      answer:
        "That isn't something Eddie's written work covers, so there's nothing here I'd stand behind" +
        // No closing full stop: the sentence ends on a quoted question, and
        // "…MVP?”." puts two terminators side by side.
        ` as an answer. You could try ${suggestionSentence()}`,
        citations: [],
      }),
      {
        outcome: 'no_context',
        grounded: false,
        questionLength: validated.question.length,
        grantType,
      },
      // The span exists even though no generation will. Without it every
      // unanswerable question would be invisible, and "% answered" — computed
      // as generations over traces — would silently exclude its denominator.
      //
      // It carries the question too, and only here: a decline calls no model,
      // so this is the one place the questions the corpus cannot reach get
      // recorded. That is the dataset a disputed decline points at, and the
      // evidence #69 wants before anyone builds an embeddings pass.
      {
        retrieval: {
          traceId,
          retrievedIds: [],
          floorCleared: false,
          question: validated.question,
        },
      },
    );
  }

  const retrieval = {
    traceId,
    retrievedIds: selected.map((entry) => entry.id),
    floorCleared: true,
  };
  const questionLength = validated.question.length;

  const apiKey = await readSecret('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.error('[air] ANTHROPIC_API_KEY is not configured');
    return finish(
      json({ error: 'A.I.R. is not configured right now.' }, 503),
      { outcome: 'misconfigured', questionLength, grantType },
      { retrieval },
    );
  }

  const client = new Anthropic({ apiKey });

  let response;
  const startedAt = Date.now();
  try {
    response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      // Grounded extraction over four short documents does not need deep
      // reasoning, and effort is the primary latency and cost lever here.
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: ANSWER_SCHEMA },
      },
      system: buildSystemPrompt(),
      messages: [
        {
          role: 'user',
          content: buildUserMessage(validated.question, selected),
        },
      ],
    });
  } catch (error) {
    console.error('[air] model request failed', error);
    // Recorded as an exception as well as an outcome: the trace says what
    // happened, the exception says what threw. An Anthropic 429, a 529, a
    // timeout and a network failure are one indistinguishable 502 today.
    telemetry.recordError(error, { outcome: 'upstream_error', model });
    return finish(
      json({ error: 'A.I.R. could not answer that just now.' }, 502),
      { outcome: 'upstream_error', questionLength, grantType, model },
      { retrieval },
    );
  }

  const ms = Date.now() - startedAt;
  const usage = response.usage ?? {};
  /** Shared by every exit below, so a generation is never lost to an early return. */
  const generation = {
    traceId,
    model,
    ms,
    usage,
    stopReason: response.stop_reason,
    // Capturing question and answer is a deliberate decision, and privacy mode
    // stays off because it exists to exclude exactly these two. They live only
    // in the ai_events table and expire after 30 days; the metadata persists.
    input: [{ role: 'user', content: validated.question }],
  };

  // Safety classifiers can decline a request outright; that arrives as a
  // successful response with no content, so check before reading it.
  if (response.stop_reason === 'refusal') {
    return finish(
      json({
        grounded: false,
        answer:
          "I can't answer that one. Ask me about Eddie's work and I'll do better.",
        citations: [],
      }),
      { outcome: 'refusal', grounded: false, questionLength, grantType, model },
      { retrieval, generation },
    );
  }

  const text =
    response.content.find((block) => block.type === 'text')?.text ?? '';

  let answer;
  try {
    answer = JSON.parse(text);
  } catch {
    console.error('[air] model returned unparseable output');
    // stop_reason on the generation is what separates this from truncation.
    // Until now the two were one 502 and the difference was unknowable.
    return finish(
      json({ error: 'A.I.R. could not answer that just now.' }, 502),
      {
        outcome: response.stop_reason === 'max_tokens' ? 'truncated' : 'unparseable',
        questionLength,
        grantType,
        model,
      },
      { retrieval, generation: { ...generation, output: text } },
    );
  }

  // The layer that does not depend on the model cooperating. A cited story
  // that retrieval never supplied is a fabricated source, and it is refused
  // here rather than rendered to a visitor.
  const verdict = verifyAnswer(answer, selected);
  if (!verdict.ok) {
    console.error(`[air] answer failed verification: ${verdict.reason}`);
    return finish(
      json({
        grounded: false,
        answer:
          "I couldn't ground that answer in Eddie's written work, so I'd rather not guess. Try asking it a different way.",
        citations: [],
      }),
      {
        outcome: 'verification_failed',
        grounded: false,
        questionLength,
        grantType,
        model,
      },
      {
        retrieval,
        generation: { ...generation, verificationReason: verdict.reason },
      },
    );
  }

  return finish(
    json({
      grounded: answer.grounded,
      answer: answer.answer,
      citations: answer.citations,
      // Titles let the UI show what an answer was drawn from without a second
      // round trip to look the ids up.
      sources: selected
        .filter((entry) => answer.citations.includes(entry.id))
        .map((entry) => ({ id: entry.id, title: entry.data.title })),
      // Returned so a rating can be joined to the generation that produced it.
      // Nothing consumes it until Wave 3 (#67); it is one field, and shipping
      // it now means that wave needs no second edit to this file.
      traceId,
    }),
    {
      outcome: 'answered',
      grounded: answer.grounded,
      questionLength,
      grantType,
      model,
    },
    {
      retrieval,
      generation: {
        ...generation,
        output: answer.answer,
        citationCount: answer.citations?.length ?? 0,
      },
    },
  );
}
