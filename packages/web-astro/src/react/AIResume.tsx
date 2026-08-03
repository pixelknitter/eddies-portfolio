import React from 'react';

import Modal from './Modal';
import AnswerFeedback from './AnswerFeedback';

/**
 * A.I.R. — the interactive resume.
 *
 * Answers come from `/api/air/ask`, which grounds them in Eddie's STAR stories
 * and project write-ups. This component renders three things the endpoint
 * guarantees and most chat UIs drop: the sources an answer drew on, an honest
 * decline when the corpus does not cover a question, and a visible distinction
 * between the two. An ungrounded answer that looks identical to a grounded one
 * is the failure mode worth designing against.
 */

type Source = { id: string; title: string };

type Answer = {
  grounded: boolean;
  answer: string;
  citations: string[];
  sources?: Source[];
  /**
   * Ties feedback to the trace that produced this answer. The endpoint has
   * returned it since Wave 1; nothing read it until there was something to
   * attach. Optional because an older cached response may not carry one, and a
   * missing id means no feedback control rather than a broken render.
   */
  traceId?: string;
};

/**
 * Openers aimed at who the visitor probably is. People rarely know what to ask
 * an interactive resume, and a blank box gets a blank response.
 */
// Shared with the decline message in api/air/ask.ts.
import { SUGGESTED } from '../util/air/suggested.mjs';

export function AIResume() {
  const [accessCode, setAccessCode] = React.useState('');
  const [requesting, setRequesting] = React.useState(false);
  const [requestEmail, setRequestEmail] = React.useState('');
  const [requestReason, setRequestReason] = React.useState('');
  const [requestState, setRequestState] = React.useState<
    | { status: 'idle' | 'sending' }
    | { status: 'sent' | 'failed'; message: string }
  >({ status: 'idle' });
  const [question, setQuestion] = React.useState('');
  const [answer, setAnswer] = React.useState<Answer | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const requestEmailRef = React.useRef<HTMLInputElement>(null);

  // Move focus into the dialog when it opens, so keyboard and screen-reader
  // users land inside it rather than behind it.
  React.useEffect(() => {
    if (requesting) requestEmailRef.current?.focus();
  }, [requesting]);

  // Dismissing clears the outcome as well as closing: reopening the dialog with
  // last attempt's error still under the button reads as a fresh failure.
  const closeRequest = React.useCallback(() => {
    setRequesting(false);
    setRequestState({ status: 'idle' });
  }, []);

  async function submitRequest(event: React.FormEvent) {
    event.preventDefault();
    if (requestState.status === 'sending') return;

    setRequestState({ status: 'sending' });

    try {
      const response = await fetch('/api/air/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: requestEmail, reason: requestReason }),
      });
      const body = await response.json();

      setRequestState(
        response.ok
          ? { status: 'sent', message: body.message ?? 'Sent.' }
          : {
              status: 'failed',
              message: body.error ?? 'Could not send that. Try again.',
            },
      );
    } catch {
      setRequestState({
        status: 'failed',
        message: 'Could not reach the site. Try again.',
      });
    }
  }

  async function ask(asked: string) {
    const trimmed = asked.trim();
    if (!trimmed || pending) return;

    setPending(true);
    setError(null);
    setAnswer(null);
    setQuestion(trimmed);

    try {
      const response = await fetch('/api/air/ask', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-air-access': accessCode,
        },
        body: JSON.stringify({ question: trimmed }),
      });

      /*
       * Parsed defensively, and *after* the status is known.
       *
       * This used to be a bare `await response.json()` above the `response.ok`
       * check. An error response with an empty body — which is exactly what
       * Astro returns when an endpoint throws — made that parse throw, so
       * control jumped to the `catch` below and the visitor was told to check
       * their connection. The connection was fine; the server had answered 500
       * with zero bytes. A server fault reported as the user's network is worse
       * than an unhelpful error, because it sends them to fix the wrong thing.
       */
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setError(
          body?.error ??
            `A.I.R. couldn't answer that (error ${response.status}). This is a problem on my end, not yours.`,
        );
        return;
      }

      // A 200 that did not parse is still a broken answer, and must not fall
      // through to render as one.
      if (!body) {
        setError('A.I.R. sent a reply I could not read. Try again in a moment.');
        return;
      }

      setAnswer(body as Answer);
    } catch {
      setError('Could not reach A.I.R. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <h1>Hello there, Welcome to A.I.R.! 👋</h1>
      <p className="font-body text-lg">
        The AI-powered Resume. It answers from Eddie&rsquo;s written work
        &mdash; and tells you when it can&rsquo;t.
      </p>

      <div className="surface mt-6 p-4 sm:p-6">
        <label
          htmlFor="air-access"
          className="mb-2 block font-body font-semibold"
        >
          Access code
        </label>
        <input
          id="air-access"
          type="password"
          value={accessCode}
          onChange={(event) => setAccessCode(event.target.value)}
          className="w-full rounded-lg border border-hairline bg-surface p-3 text-dark focus:outline-2 focus:outline-offset-2 focus:outline-underline dark:border-hairline-dark dark:bg-surface-dark dark:text-light dark:focus:outline-link"
          placeholder="The code from the card"
          autoComplete="off"
        />

        <button
          type="button"
          onClick={() => setRequesting(true)}
          className="mt-2 font-body text-sm underline decoration-underline underline-offset-4 dark:decoration-link"
        >
          Don&rsquo;t have one? Ask Eddie for access
        </button>

        <label
          htmlFor="air-question"
          className="mt-6 mb-2 block font-body font-semibold"
        >
          Ask a question
        </label>
        <input
          id="air-question"
          ref={inputRef}
          className="w-full rounded-lg border border-hairline bg-surface p-3 text-dark focus:outline-2 focus:outline-offset-2 focus:outline-underline dark:border-hairline-dark dark:bg-surface-dark dark:text-light dark:focus:outline-link"
          placeholder="What's something you want to know about Eddie?"
          onKeyDown={(event) => {
            if (event.key === 'Enter') ask(event.currentTarget.value);
          }}
        />
        <p className="mt-2 font-body text-sm opacity-70">Press Enter to ask.</p>

        <div className="mt-6">
          <p className="mb-2 font-body text-sm font-semibold">
            Not sure where to start?
          </p>
          <ul className="flex list-none flex-col gap-2 pl-0">
            {SUGGESTED.map((item) => (
              <li key={item.question}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (inputRef.current)
                      inputRef.current.value = item.question;
                    ask(item.question);
                  }}
                  className="w-full rounded-lg border border-hairline p-3 text-left transition-colors hover:border-underline disabled:opacity-50 dark:border-hairline-dark dark:hover:border-link"
                >
                  <span className="badge">{item.audience}</span>
                  <span className="mt-2 block font-body">{item.question}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <Modal
        open={requesting}
        onClose={closeRequest}
        titleId="air-request-title"
      >
        {requestState.status === 'sent' ? (
          // Replaces the form: a live "Send request" after a successful send
          // invites a second submission.
          <div>
            <h2
              id="air-request-title"
              className="mb-2 font-body text-xl no-underline decoration-0"
            >
              Request sent
            </h2>
            <p className="font-body">{requestState.message}</p>
            <div className="mt-6">
              <button
                type="button"
                onClick={closeRequest}
                className="btn rounded-lg border border-hairline px-4 py-2 transition-colors hover:border-underline dark:border-hairline-dark dark:hover:border-link"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div>
            <h2
              id="air-request-title"
              className="mb-2 font-body text-xl no-underline decoration-0"
            >
              Ask for access
            </h2>
            <p className="mb-4 font-body text-sm opacity-70">
              Eddie reads these himself and approves them by hand. Tell him who
              you are and what you&rsquo;re hoping to find out.
            </p>

            <form onSubmit={submitRequest}>
              <label
                htmlFor="air-request-email"
                className="mb-2 block font-body font-semibold"
              >
                Your email
              </label>
              <input
                id="air-request-email"
                ref={requestEmailRef}
                type="email"
                required
                value={requestEmail}
                onChange={(event) => setRequestEmail(event.target.value)}
                className="w-full rounded-lg border border-hairline bg-surface p-3 text-dark focus:outline-2 focus:outline-offset-2 focus:outline-underline dark:border-hairline-dark dark:bg-surface-dark dark:text-light dark:focus:outline-link"
                placeholder="you@company.com"
              />

              <label
                htmlFor="air-request-reason"
                className="mt-4 mb-2 block font-body font-semibold"
              >
                Why you&rsquo;re reaching out
              </label>
              <textarea
                id="air-request-reason"
                required
                rows={4}
                value={requestReason}
                onChange={(event) => setRequestReason(event.target.value)}
                className="w-full rounded-lg border border-hairline bg-surface p-3 text-dark focus:outline-2 focus:outline-offset-2 focus:outline-underline dark:border-hairline-dark dark:bg-surface-dark dark:text-light dark:focus:outline-link"
                placeholder="Hiring for a platform role and wanted to understand how you work."
              />

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={requestState.status === 'sending'}
                  className="btn min-w-36 rounded-lg border border-hairline px-4 py-2 text-center transition-colors hover:border-underline disabled:opacity-50 dark:border-hairline-dark dark:hover:border-link"
                >
                  {requestState.status === 'sending'
                    ? 'Sending…'
                    : 'Send request'}
                </button>
                <button
                  type="button"
                  onClick={closeRequest}
                  className="font-body text-sm underline decoration-underline underline-offset-4 dark:decoration-link"
                >
                  Cancel
                </button>
              </div>
            </form>

            {/* Height reserved, so a message arriving does not shove the buttons
              up. The 503 from an unconfigured environment returns in well under
              a second, and the shift as "Sending…" swapped back while this
              paragraph mounted was the flicker. */}
            {/* Height reserved so an arriving message does not shift the buttons —
              that shift was visible as a flicker on fast rejections. */}
            <div aria-live="polite" className="mt-4 min-h-6">
              {requestState.status === 'failed' && (
                <p className="font-body">{requestState.message}</p>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* aria-live so an arriving answer is announced, not just painted. */}
      <div aria-live="polite" aria-busy={pending}>
        {pending && (
          <p className="mt-6 font-body opacity-70">
            Reading through Eddie&rsquo;s work&hellip;
          </p>
        )}

        {error && (
          <div className="surface mt-6 p-4 sm:p-6">
            <p className="font-body">{error}</p>
          </div>
        )}

        {answer && (
          <div className="surface mt-6 p-4 sm:p-6">
            <h2 className="mb-3 font-body text-xl no-underline decoration-0">
              {question}
            </h2>

            {answer.answer
              .split('\n')
              .filter(Boolean)
              .map((paragraph, index) => (
                <p key={index} className="mb-3 font-body leading-relaxed">
                  {paragraph}
                </p>
              ))}

            {answer.grounded && answer.sources && answer.sources.length > 0 && (
              <div className="mt-4 border-t border-hairline pt-4 dark:border-hairline-dark">
                <p className="mb-2 font-body text-sm font-semibold">
                  Drawn from
                </p>
                <ul className="flex list-none flex-wrap gap-2 pl-0">
                  {answer.sources.map((source) => (
                    <li key={source.id}>
                      <span className="badge">{source.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!answer.grounded && (
              <p className="mt-4 border-t border-hairline pt-4 font-body text-sm opacity-70 dark:border-hairline-dark">
                No sources &mdash; this answer isn&rsquo;t grounded in
                Eddie&rsquo;s written work, so treat it as a gap rather than an
                assessment.
              </p>
            )}

            {/* Rating on a grounded answer, dispute on a decline — the
              component picks, so the two signals never share a control. Absent
              without a trace id, since feedback with nothing to attach to is
              worse than none. */}
            {answer.traceId && (
              <AnswerFeedback
                grounded={answer.grounded}
                traceId={answer.traceId}
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export default AIResume;
