import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';
import Anthropic from '@anthropic-ai/sdk';

import { showAIR, showUnpublished } from '@util/visibility.mjs';
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

const MODEL = 'claude-opus-5';

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

export async function POST(context: APIContext): Promise<Response> {
  // The section is gated, and so is its API. A flagged-off feature whose
  // endpoint still answers is not gated, it is merely unlinked.
  if (!showAIR(import.meta.env)) {
    return new Response(null, { status: 404, statusText: 'Not found' });
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
    // difference is operator information, not visitor information.
    return json({ error: 'This resume is available by invitation.' }, 401);
  }

  const clientId =
    context.request.headers.get('cf-connecting-ip') ??
    context.request.headers.get('x-forwarded-for') ??
    'unknown';

  const rate = limiter.check(clientId);
  if (!rate.allowed) {
    return json(
      { error: 'Too many questions in a short window. Try again shortly.' },
      429,
      { 'retry-after': String(rate.retryAfterSeconds) },
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
  const reveal = showUnpublished(import.meta.env);
  const stories = await getCollection(
    'star',
    ({ data }) => reveal || data.draft !== true,
  );
  const projects = await getCollection('projects');

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
  ];

  const selected = selectContext(validated.question, corpus);

  // Nothing relevant retrieved: decline here rather than asking the model to
  // answer from an empty context. This is the boundary guarantee — it holds
  // even if the prompt is ignored entirely, because no request is made.
  if (selected.length === 0) {
    return json({
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
    });
  }

  const apiKey = await readSecret('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.error('[air] ANTHROPIC_API_KEY is not configured');
    return json({ error: 'A.I.R. is not configured right now.' }, 503);
  }

  const client = new Anthropic({ apiKey });

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
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
    return json({ error: 'A.I.R. could not answer that just now.' }, 502);
  }

  // Safety classifiers can decline a request outright; that arrives as a
  // successful response with no content, so check before reading it.
  if (response.stop_reason === 'refusal') {
    return json({
      grounded: false,
      answer:
        "I can't answer that one. Ask me about Eddie's work and I'll do better.",
      citations: [],
    });
  }

  const text =
    response.content.find((block) => block.type === 'text')?.text ?? '';

  let answer;
  try {
    answer = JSON.parse(text);
  } catch {
    console.error('[air] model returned unparseable output');
    return json({ error: 'A.I.R. could not answer that just now.' }, 502);
  }

  // The layer that does not depend on the model cooperating. A cited story
  // that retrieval never supplied is a fabricated source, and it is refused
  // here rather than rendered to a visitor.
  const verdict = verifyAnswer(answer, selected);
  if (!verdict.ok) {
    console.error(`[air] answer failed verification: ${verdict.reason}`);
    return json({
      grounded: false,
      answer:
        "I couldn't ground that answer in Eddie's written work, so I'd rather not guess. Try asking it a different way.",
      citations: [],
    });
  }

  return json({
    grounded: answer.grounded,
    answer: answer.answer,
    citations: answer.citations,
    // Titles let the UI show what an answer was drawn from without a second
    // round trip to look the ids up.
    sources: selected
      .filter((entry) => answer.citations.includes(entry.id))
      .map((entry) => ({ id: entry.id, title: entry.data.title })),
  });
}
