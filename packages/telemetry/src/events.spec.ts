import { describe, it, expect } from 'vitest';

import { SURVEYS, EVENTS } from './events.mjs';

/**
 * One place that names every event.
 *
 * This is what stops `air_answer_rated` drifting into `air_rating_submitted`
 * between a call site and a dashboard, and it is why the survey ids are not
 * inline in a React component: they are PostHog objects created ahead of the
 * code, and a typo in one produces feedback that silently attaches to nothing.
 */
describe('the event contract', () => {
  it('carries the provisioned survey ids', () => {
    expect(SURVEYS.answerQuality.id).toBe('019fc122-7de8-0000-7fa8-0bf8842ad239');
    expect(SURVEYS.declineDispute.id).toBe('019fc122-9c54-0000-b9ef-9a66c58aef0b');
  });

  it('keys responses by question id, which is how PostHog stores them', () => {
    // Responses arrive as $survey_response_<question_id>. Getting one wrong
    // produces a survey whose responses never render against it — and nothing
    // errors, which is the worst version of wrong.
    const ids = [
      SURVEYS.answerQuality.questions.helpful,
      SURVEYS.answerQuality.questions.whatWasWrong,
      SURVEYS.declineDispute.questions.expected,
    ];

    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it('gives the two surveys different ids', () => {
    // The whole point of two surveys is that a bad answer and a decline stay
    // separable. One id shared between them would silently merge the signals
    // this design went out of its way to keep apart.
    expect(SURVEYS.answerQuality.id).not.toBe(SURVEYS.declineDispute.id);
  });

  it('is frozen, so a call site cannot rename an event at runtime', () => {
    expect(Object.isFrozen(SURVEYS)).toBe(true);
    expect(Object.isFrozen(SURVEYS.answerQuality)).toBe(true);
    expect(Object.isFrozen(SURVEYS.answerQuality.questions)).toBe(true);
    expect(Object.isFrozen(EVENTS)).toBe(true);
  });

  it('names the resume funnel steps', () => {
    expect(EVENTS.resumeFormOpened).toBe('resume_form_opened');
    expect(EVENTS.resumeDownloadTriggered).toBe('resume_download_triggered');
  });
});
