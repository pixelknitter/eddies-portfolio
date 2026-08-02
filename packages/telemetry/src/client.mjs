/**
 * The client-side telemetry interface, and a default that does nothing.
 *
 * ## Why an interface at all
 *
 * So no consumer imports a vendor SDK directly. Every call site talks to this
 * shape; `posthog.mjs` is the only module that knows what PostHog is, and it
 * receives the SDK rather than importing it. That is what lets the same package
 * serve a browser and React Native — the consumer hands in `posthog-js` or
 * `posthog-react-native`, and nothing here changes.
 *
 * ## Why the no-op is the default
 *
 * Not a convenience. Every call site has to work before anything is configured,
 * so an unset key, a blocked script, or a failed dynamic import degrades to
 * silence rather than to a broken page. `createTransport` already makes that
 * guarantee in the Worker; this is the same promise on the client.
 *
 * `active` is how a caller tells the two apart — the loader uses it to decide
 * whether the real client has taken over yet.
 *
 * @typedef {object} TelemetryClient
 * @property {boolean} active
 *   False until a real implementation has been initialised.
 * @property {(config: {token: string, host?: string}) => void} init
 * @property {(route: string) => void} pageview
 * @property {(event: string, properties?: Record<string, unknown>) => void} capture
 * @property {(surveyId: string, traceId: string) => void} surveyShown
 *   A survey was put in front of someone. Separate from `surveySent` so
 *   response rate is measurable rather than inferred.
 * @property {(surveyId: string, traceId: string, responses: Record<string, unknown>) => void} surveySent
 *   `responses` is keyed `$survey_response_<question_id>`, which is how PostHog
 *   stores them — see `events.mjs` for the ids.
 */

/**
 * A client that accepts every call and does nothing with any of it.
 *
 * @returns {TelemetryClient}
 */
export function createNoopClient() {
  /*
   * The empty bodies are the whole object. This is a null implementation, and
   * giving each method a token statement to satisfy the linter would imply
   * something happens on a call — the opposite of what a reader needs to know
   * here. Silenced once rather than five times.
   */
  /* eslint-disable @typescript-eslint/no-empty-function */
  return {
    active: false,
    init() {},
    pageview() {},
    capture() {},
    surveyShown() {},
    surveySent() {},
  };
  /* eslint-enable @typescript-eslint/no-empty-function */
}
