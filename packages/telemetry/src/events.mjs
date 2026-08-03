/**
 * Every event this package emits, named once.
 *
 * The `$ai_*` triad is not here — `llm.mjs` owns it and keeps it. This covers
 * everything else, and exists so an event name is defined in one place rather
 * than typed at a call site and again in a dashboard, where the two can differ
 * without anything failing.
 *
 * ## Why the ids live here
 *
 * Surveys are PostHog objects created *before* the code that feeds them, and
 * their responses are keyed `$survey_response_<question_id>`. That makes the
 * question ids load-bearing rather than incidental: a wrong one produces
 * feedback that attaches to nothing, silently. Frozen so a call site cannot
 * rename an event at runtime.
 */

/**
 * The two feedback surveys.
 *
 * Two, not one, because a bad answer and a decline are opposite failures. A
 * single control would put "this was wrong" and "there was nothing here" in one
 * field, after which telling them apart depends on everyone remembering to
 * filter. Distinct `$survey_id`s keep them separable by construction.
 */
export const SURVEYS = Object.freeze({
  /** Shown only when `grounded: true`. */
  answerQuality: Object.freeze({
    id: '019fc122-7de8-0000-7fa8-0bf8842ad239',
    questions: Object.freeze({
      helpful: '4c346a19-26ed-47e8-b6b9-6c4ea7596917',
      whatWasWrong: 'a8c1f487-4475-4e8d-9c03-a79008825840',
    }),
  }),

  /**
   * Shown only when `grounded: false`.
   *
   * Sending it *is* the dispute: its one question is optional so a click alone
   * records, because requiring a sentence would cost most of the signal. The
   * sentence, when it comes, is the most valuable field in the wave — it is
   * what separates a vocabulary gap from a content gap.
   */
  declineDispute: Object.freeze({
    id: '019fc122-9c54-0000-b9ef-9a66c58aef0b',
    questions: Object.freeze({
      expected: '0c0d27ee-f089-4d6a-9f65-293860c2fbf7',
    }),
  }),
});

/** Product events that are not survey responses. */
export const EVENTS = Object.freeze({
  resumeFormOpened: 'resume_form_opened',
  resumeDownloadTriggered: 'resume_download_triggered',
});

/**
 * The property key PostHog stores a survey answer under.
 *
 * @param {string} questionId
 * @returns {string}
 */
export function responseKey(questionId) {
  return `$survey_response_${questionId}`;
}
