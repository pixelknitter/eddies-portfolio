import { redact } from './redact.mjs';

/**
 * The PostHog adapter.
 *
 * ## Why the SDK is a parameter
 *
 * It is handed in rather than imported, which is what keeps this package free of
 * dependencies and free of platform assumptions. A browser consumer passes
 * `posthog-js`; React Native passes `posthog-react-native`; a test passes a fake
 * with two spies. None of that changes the code below.
 *
 * It also means the consumer decides *when* the SDK loads. The site
 * dynamic-imports it, and only when the scope flag says to, so a route that
 * collects nothing pays nothing.
 *
 * ## The configuration is the security boundary
 *
 * `autocapture: false` is not a preference. `ResumeDownload.tsx` renders
 * download URLs as visible `<a href>` fallbacks whose tokens decode to the
 * requester's email, and autocapture records the href of every click — on the
 * one page whose premise is publishing no way to contact Eddie. `posthog.spec.ts`
 * asserts it, because a convention cannot hold that line and a test can.
 *
 * `persistence: 'memory'` keeps ePrivacy consent out of scope: nothing is
 * written to the visitor's device, so the site needs no cookie banner. The cost
 * is identity continuity between page loads, which is an accepted trade.
 */

const DEFAULT_HOST = 'https://us.i.posthog.com';

/**
 * @param {{init: Function, capture: Function}} posthog The SDK, or a fake.
 * @returns {import('./client.mjs').TelemetryClient}
 */
export function createPostHogClient(posthog) {
  let ready = false;

  /**
   * Every outbound event goes through here, so redaction cannot be forgotten at
   * a call site — and a call made before `init` is dropped rather than thrown.
   *
   * @param {string} event
   * @param {Record<string, unknown>} [properties]
   */
  const send = (event, properties) => {
    if (!ready) return;
    posthog.capture(event, redact(properties ?? {}));
  };

  return {
    get active() {
      return ready;
    },

    init({ token, host = DEFAULT_HOST }) {
      posthog.init(token, {
        api_host: host,
        // Never. See the header, and posthog.spec.ts.
        autocapture: false,
        disable_session_recording: true,
        // No cookie, no localStorage, so no consent banner.
        persistence: 'memory',
        // Bound to astro:page-load by the consumer instead: a view transition
        // swaps the document without a page load, so the SDK's own capture
        // would miss every navigation after the first.
        capture_pageview: false,
      });
      ready = true;
    },

    pageview(route) {
      send('$pageview', { $current_url: route });
    },

    capture(event, properties) {
      send(event, properties);
    },

    /**
     * Separate from `surveySent` so response rate is measurable rather than
     * inferred. PostHog notes there is no supported way to deduplicate these
     * per trace, so treat impression counts as approximate.
     */
    surveyShown(surveyId, traceId) {
      send('survey shown', { $survey_id: surveyId, $ai_trace_id: traceId });
    },

    surveySent(surveyId, traceId, responses) {
      send('survey sent', {
        $survey_id: surveyId,
        $ai_trace_id: traceId,
        ...responses,
      });
    },
  };
}
