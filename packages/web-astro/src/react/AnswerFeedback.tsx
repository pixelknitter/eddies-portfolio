import React from 'react';

import { SURVEYS, responseKey } from '@pk/telemetry/events';
import { ensureClient, getClient } from '../util/telemetry/client.mjs';

/**
 * Asks whether an answer was any good — the one signal instrumentation cannot
 * infer.
 *
 * ## Two controls, never one
 *
 * A bad answer and a decline are opposite failures. Rating both with the same
 * widget would put "this was wrong" and "there was nothing here" in a single
 * field, after which telling them apart depends on everyone remembering to
 * filter. Distinct surveys keep them separable by construction.
 *
 * The dispute is the more valuable of the two: a decline plus a sentence saying
 * what the visitor expected is what distinguishes a vocabulary gap from a
 * content gap, which is the evidence #69 wants before anyone builds an
 * embeddings pass.
 *
 * ## Sending is the dispute
 *
 * On a decline the click alone records. The follow-up is optional because
 * requiring a sentence would cost most of the signal — most people will click
 * and not type, and that click is still a human saying the corpus should have
 * covered this.
 */

interface FeedbackClient {
  surveyShown: (surveyId: string, traceId: string) => void;
  surveySent: (
    surveyId: string,
    traceId: string,
    responses: Record<string, unknown>,
  ) => void;
}

interface Props {
  grounded: boolean;
  traceId: string;
  /** Injected by tests. Defaults to whatever the page has loaded. */
  client?: FeedbackClient;
}

export default function AnswerFeedback({ grounded, traceId, client }: Props) {
  const survey = grounded ? SURVEYS.answerQuality : SURVEYS.declineDispute;
  const telemetry = client ?? (getClient() as FeedbackClient);

  const [stage, setStage] = React.useState<'ask' | 'comment' | 'done'>('ask');
  const [comment, setComment] = React.useState('');

  React.useEffect(() => {
    /*
     * In feedback-only mode — the default — the layout does not load the SDK,
     * so the surface that needs telemetry is the one that triggers it. Fire and
     * forget: the impression below is queued by the façade and replayed when
     * the client arrives, so nothing is lost while this resolves, and nothing
     * is blocked on it either.
     *
     * Once per answer. Re-firing on every render would skew impression rates,
     * and PostHog notes there is no supported way to deduplicate these.
     */
    if (!client) void ensureClient();
    telemetry.surveyShown(survey.id, traceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [survey.id, traceId]);

  const send = (responses: Record<string, unknown>) =>
    telemetry.surveySent(survey.id, traceId, responses);

  if (stage === 'done') {
    return (
      <p className="mt-4 font-body text-sm opacity-70">
        Thanks &mdash; that helps.
      </p>
    );
  }

  if (stage === 'comment') {
    const questionId = grounded
      ? SURVEYS.answerQuality.questions.whatWasWrong
      : SURVEYS.declineDispute.questions.expected;

    return (
      <div className="mt-4 border-t border-hairline pt-4 dark:border-hairline-dark">
        <label
          htmlFor="air-feedback-comment"
          className="mb-2 block font-body text-sm"
        >
          {grounded
            ? 'What was wrong with it?'
            : 'What were you expecting to find?'}
        </label>
        <textarea
          id="air-feedback-comment"
          rows={2}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          className="w-full rounded border border-hairline p-2 font-body text-sm dark:border-hairline-dark"
        />
        <button
          type="button"
          className="btn mt-2 text-sm"
          onClick={() => {
            // Optional by design. An empty box still closes the flow, and sends
            // nothing — the dispute was already recorded on the click, and a
            // blank follow-up would be a second contentless response.
            if (comment.trim()) send({ [responseKey(questionId)]: comment });
            setStage('done');
          }}
        >
          Send
        </button>
      </div>
    );
  }

  if (!grounded) {
    return (
      <div className="mt-4 border-t border-hairline pt-4 dark:border-hairline-dark">
        <button
          type="button"
          className="btn text-sm"
          onClick={() => {
            // Sending IS the dispute — recorded before any comment.
            send({});
            setStage('comment');
          }}
        >
          Eddie should be able to answer this
        </button>
      </div>
    );
  }

  const helpfulId = SURVEYS.answerQuality.questions.helpful;

  return (
    <div className="mt-4 flex items-center gap-3 border-t border-hairline pt-4 dark:border-hairline-dark">
      <span className="font-body text-sm">Was this helpful?</span>
      <button
        type="button"
        className="btn text-sm"
        onClick={() => {
          send({ [responseKey(helpfulId)]: 'Yes' });
          setStage('done');
        }}
      >
        Yes
      </button>
      <button
        type="button"
        className="btn text-sm"
        onClick={() => {
          send({ [responseKey(helpfulId)]: 'No' });
          setStage('comment');
        }}
      >
        No
      </button>
    </div>
  );
}
