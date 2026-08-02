import { createTransport } from './transport.mjs';
import { buildTrace, buildRetrievalSpan, buildGeneration } from './llm.mjs';

export { OUTCOMES } from './llm.mjs';

/**
 * The telemetry seam.
 *
 * Four layers, one choke point. The choke point is the point: it is the only
 * place redaction can be enforced and tested, and `redact.spec.ts` is what makes
 * that guarantee structural rather than a convention.
 *
 * | Layer | Function | When |
 * |---|---|---|
 * | Analytics | `capture(event, props)` | A thing happened worth counting |
 * | Traces | `captureTrace({trace, retrieval, generation})` | The LLM request path |
 * | Errors | `recordError(err, context)` | Something threw |
 * | Alerts | `alert(severity, message, fields)` | Rare, and needs a human now |
 *
 * **Logs are deliberately not a fifth layer.** Workers Logs already exist, are
 * enabled at 100%, and the `[air]` / `[resume]` prefix convention works. Adding
 * log ingestion here would be a third destination for the same information.
 * `console.error` stays as the local breadcrumb; this adds the durable,
 * queryable channel on top of it.
 *
 * `alert()` is a no-op stub until Wave 2, when it becomes a Discord webhook. It
 * exists now so the call sites in `ask.ts` can be written once. Discord rather
 * than PostHog alerts because PostHog evaluates insights on a schedule, while a
 * Worker posting to a webhook fires at the moment of the failure and does not
 * depend on ingestion having succeeded — and for "a lead was just lost",
 * immediate matters.
 */

/**
 * @param {Record<string, unknown> | undefined} env
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   waitUntil?: (promise: Promise<unknown>) => void,
 * }} [options]
 */
export function createTelemetry(env, options = {}) {
  const transport = createTransport(env, options);

  return {
    /**
     * @param {string} event
     * @param {Record<string, unknown>} [properties]
     */
    capture(event, properties = {}) {
      transport.enqueue({ event, properties });
    },

    /**
     * A trace, its retrieval span, and — only if the model was called — its
     * generation. Enqueued together so they leave in one request.
     *
     * `retrieval` is omitted when the request exited before retrieval ran —
     * `unauthorised`, `rate_limited`. Emitting a span with `retrieved_count: 0`
     * there would be indistinguishable from `no_context`, which is the one
     * signal this design is most careful to keep clean.
     *
     * @param {{
     *   trace: Parameters<typeof buildTrace>[0],
     *   retrieval?: Parameters<typeof buildRetrievalSpan>[0],
     *   generation?: Parameters<typeof buildGeneration>[0],
     * }} parts
     */
    captureTrace(parts) {
      transport.enqueue(buildTrace(parts.trace));
      if (parts.retrieval) {
        transport.enqueue(buildRetrievalSpan(parts.retrieval));
      }
      if (parts.generation) {
        transport.enqueue(buildGeneration(parts.generation));
      }
    },

    /**
     * @param {unknown} error
     * @param {Record<string, unknown>} [context]
     */
    recordError(error, context = {}) {
      const isError = error instanceof Error;

      transport.enqueue({
        event: '$exception',
        properties: {
          ...context,
          $exception_level: 'error',
          $exception_message: isError ? error.message : String(error),
          error_name: isError ? error.name : typeof error,
          /*
           * The SDK attaches `status` to API errors. Without it an Anthropic
           * 429, a 529, a timeout and a network failure are one indistinguishable
           * 502 — and they are the difference between "add backoff", "wait it
           * out" and "raise the timeout".
           */
          error_status:
            error && typeof error === 'object' && 'status' in error
              ? /** @type {{status?: unknown}} */ (error).status
              : undefined,
        },
      });
    },

    /**
     * Stub until Wave 2 (#66). Deliberately does nothing rather than falling
     * back to a `console.error`, which would read as an alert having fired.
     *
     * The empty body is the point, so the lint rule is silenced here rather
     * than satisfied with a token statement that would imply something happens.
     * It exists now so the call sites in `ask.ts` are written once.
     *
     * @param {'warn' | 'error'} _severity
     * @param {string} _message
     * @param {Record<string, unknown>} [_fields]
     */
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    alert(_severity, _message, _fields) {},

    flush: transport.flush,
  };
}
