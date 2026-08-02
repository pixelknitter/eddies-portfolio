import { describe, it, expect, vi } from 'vitest';

import { createPostHogClient } from './posthog.mjs';

/**
 * The PostHog adapter, tested against a fake SDK.
 *
 * A fake is possible because the adapter takes the SDK as an argument rather
 * than importing it — the same property that lets a React Native consumer hand
 * in `posthog-react-native`. Nothing here needs a DOM, which is why this package
 * stays on the node test environment.
 */

function fakePosthog() {
  return {
    init: vi.fn(),
    capture: vi.fn(),
  };
}

/** @returns the config object passed to `posthog.init`. */
function configFrom(posthog: ReturnType<typeof fakePosthog>) {
  return posthog.init.mock.calls[0][1] as Record<string, unknown>;
}

describe('createPostHogClient', () => {
  describe('the configuration that must not regress', () => {
    it('never enables autocapture', () => {
      /*
       * The most important assertion in this package.
       *
       * ResumeDownload.tsx renders download URLs as visible <a href> fallbacks
       * whose tokens decode to the requester's email, and autocapture records
       * the href of every click. Until now a config flag was the only thing
       * between that and handing a stranger's address to a third party — on the
       * one page whose entire premise is publishing no way to contact Eddie.
       *
       * A convention cannot hold that line. A test can.
       */
      const posthog = fakePosthog();
      createPostHogClient(posthog).init({ token: 'phc_test' });

      expect(configFrom(posthog).autocapture).toBe(false);
    });

    it('never enables session recording', () => {
      const posthog = fakePosthog();
      createPostHogClient(posthog).init({ token: 'phc_test' });

      expect(configFrom(posthog).disable_session_recording).toBe(true);
    });

    it('stores nothing on the visitor’s device', () => {
      // persistence: 'memory' is what keeps ePrivacy consent out of scope. If
      // this regresses the site needs a cookie banner, and nobody would notice
      // it had started needing one.
      const posthog = fakePosthog();
      createPostHogClient(posthog).init({ token: 'phc_test' });

      expect(configFrom(posthog).persistence).toBe('memory');
    });

    it('leaves pageviews to the caller', () => {
      // A view transition swaps the document without a page load, so the SDK's
      // own pageview capture would miss every navigation after the first.
      // Layout.astro binds astro:page-load instead.
      const posthog = fakePosthog();
      createPostHogClient(posthog).init({ token: 'phc_test' });

      expect(configFrom(posthog).capture_pageview).toBe(false);
    });
  });

  describe('redaction', () => {
    it('strips an email out of a survey comment', () => {
      // The comment is a stranger's free text. redact is the choke point every
      // payload passes through, and the adapter is where it applies on this
      // side — the same implementation the Worker uses, not a second copy.
      const posthog = fakePosthog();
      const client = createPostHogClient(posthog);
      client.init({ token: 'phc_test' });

      client.surveySent('survey-1', 'trace-1', {
        $survey_response_q1: 'mail me at someone@example.com',
      });

      const [, properties] = posthog.capture.mock.calls[0];
      expect(properties.$survey_response_q1).not.toContain('someone@example.com');
    });
  });

  describe('survey events', () => {
    it('attaches the trace id, so feedback lands on the answer it judges', () => {
      const posthog = fakePosthog();
      const client = createPostHogClient(posthog);
      client.init({ token: 'phc_test' });

      client.surveyShown('survey-1', 'trace-1');

      expect(posthog.capture).toHaveBeenCalledWith('survey shown', {
        $survey_id: 'survey-1',
        $ai_trace_id: 'trace-1',
      });
    });

    it('sends responses alongside the identifiers', () => {
      const posthog = fakePosthog();
      const client = createPostHogClient(posthog);
      client.init({ token: 'phc_test' });

      client.surveySent('survey-1', 'trace-1', { $survey_response_q1: 'Yes' });

      expect(posthog.capture).toHaveBeenCalledWith('survey sent', {
        $survey_id: 'survey-1',
        $ai_trace_id: 'trace-1',
        $survey_response_q1: 'Yes',
      });
    });
  });

  describe('before init', () => {
    it('does nothing rather than throwing', () => {
      // Same promise as the no-op client: a call site must work whether or not
      // the SDK ever loaded.
      const posthog = fakePosthog();
      const client = createPostHogClient(posthog);

      expect(() => client.capture('too_early')).not.toThrow();
      expect(posthog.capture).not.toHaveBeenCalled();
    });

    it('reports itself inactive until initialised', () => {
      const posthog = fakePosthog();
      const client = createPostHogClient(posthog);

      expect(client.active).toBe(false);
      client.init({ token: 'phc_test' });
      expect(client.active).toBe(true);
    });
  });
});
