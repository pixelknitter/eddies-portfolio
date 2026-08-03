import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AnswerFeedback from './AnswerFeedback';

/**
 * The one signal instrumentation cannot infer: was the answer any good.
 *
 * Two controls, never one. A bad answer and a decline are opposite failures —
 * "this was wrong" versus "there was nothing here" — and a single widget would
 * put them in one field, after which telling them apart depends on everyone
 * remembering to filter.
 */

const ANSWER_QUALITY = '019fc122-7de8-0000-7fa8-0bf8842ad239';
const DECLINE_DISPUTE = '019fc122-9c54-0000-b9ef-9a66c58aef0b';

function fakeClient() {
  return { surveyShown: vi.fn(), surveySent: vi.fn(), active: true };
}

describe('a grounded answer', () => {
  it('asks whether it helped', () => {
    render(<AnswerFeedback grounded traceId="t1" client={fakeClient()} />);

    expect(screen.getByRole('button', { name: /^yes$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^no$/i })).toBeInTheDocument();
  });

  it('records the impression, so response rate is measurable', () => {
    const client = fakeClient();
    render(<AnswerFeedback grounded traceId="t1" client={client} />);

    expect(client.surveyShown).toHaveBeenCalledWith(ANSWER_QUALITY, 't1');
  });

  it('sends and closes on a thumbs-up, asking nothing further', async () => {
    const client = fakeClient();
    render(<AnswerFeedback grounded traceId="t1" client={client} />);

    await userEvent.click(screen.getByRole('button', { name: /^yes$/i }));

    expect(client.surveySent).toHaveBeenCalledWith(
      ANSWER_QUALITY,
      't1',
      expect.objectContaining({
        '$survey_response_4c346a19-26ed-47e8-b6b9-6c4ea7596917': 'Yes',
      }),
    );
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('asks what was wrong only after a thumbs-down', async () => {
    const client = fakeClient();
    render(<AnswerFeedback grounded traceId="t1" client={client} />);

    await userEvent.click(screen.getByRole('button', { name: /^no$/i }));

    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});

describe('a decline', () => {
  it('offers a dispute rather than a rating', () => {
    render(<AnswerFeedback grounded={false} traceId="t1" client={fakeClient()} />);

    expect(
      screen.getByRole('button', { name: /should be able to answer/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^yes$/i })).toBeNull();
  });

  it('records on the click alone, before any comment', async () => {
    // Requiring a sentence would cost most of the signal. The click is the
    // dispute; the sentence is a bonus.
    const client = fakeClient();
    render(<AnswerFeedback grounded={false} traceId="t1" client={client} />);

    await userEvent.click(
      screen.getByRole('button', { name: /should be able to answer/i }),
    );

    expect(client.surveySent).toHaveBeenCalledWith(DECLINE_DISPUTE, 't1', {});
  });

  it('then invites what they expected, optionally', async () => {
    const client = fakeClient();
    render(<AnswerFeedback grounded={false} traceId="t1" client={client} />);

    await userEvent.click(
      screen.getByRole('button', { name: /should be able to answer/i }),
    );
    await userEvent.type(screen.getByRole('textbox'), 'his Kotlin work');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(client.surveySent).toHaveBeenLastCalledWith(
      DECLINE_DISPUTE,
      't1',
      expect.objectContaining({
        '$survey_response_0c0d27ee-f089-4d6a-9f65-293860c2fbf7':
          'his Kotlin work',
      }),
    );
  });

  it('does not send an empty comment as a second response', async () => {
    // The dispute is already recorded. A blank follow-up would be a second,
    // contentless response inflating the count.
    const client = fakeClient();
    render(<AnswerFeedback grounded={false} traceId="t1" client={client} />);

    await userEvent.click(
      screen.getByRole('button', { name: /should be able to answer/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(client.surveySent).toHaveBeenCalledTimes(1);
  });
});

describe('the two never appear together', () => {
  it('uses different survey ids for the two states', async () => {
    const grounded = fakeClient();
    const declined = fakeClient();

    const view = render(
      <AnswerFeedback grounded traceId="t1" client={grounded} />,
    );
    view.unmount();
    render(<AnswerFeedback grounded={false} traceId="t1" client={declined} />);

    expect(grounded.surveyShown).toHaveBeenCalledWith(ANSWER_QUALITY, 't1');
    expect(declined.surveyShown).toHaveBeenCalledWith(DECLINE_DISPUTE, 't1');
  });
});
