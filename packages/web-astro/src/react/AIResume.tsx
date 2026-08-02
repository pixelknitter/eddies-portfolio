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
import { readStoredCode, storeCode } from '../util/air/access-code.mjs';

interface Props {
  /**
   * `'dialog'` drops the page heading and lede: inside a modal the dialog's
   * own title already says what this is, and a second one reads as a page
   * embedded in a page.
   */
  variant?: 'page' | 'dialog';
}

export function AIResume({ variant = 'page' }: Props = {}) {
  const [accessCode, setAccessCode] = React.useState('');
  const [draft, setDraft] = React.useState('');
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

  // Read storage after mount, not in the state initialiser: this island is
  // server-rendered, where `window` does not exist, and a first client render
  // that disagreed with the server's HTML would hydrate wrong.
  React.useEffect(() => {
    setAccessCode(readStoredCode());
  }, []);

  const hasCode = accessCode !== '';

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
      {/*
        Says what the page does rather than greeting the visitor. A.I.R. is a
        way to read the résumé now, not a product with its own front door — the
        route says so too, at /cv/air. The second line stays: naming the limit
        up front is the most useful thing this page can tell someone, and it is
        the claim the whole grounding apparatus exists to keep.
      */}
      {variant === 'page' && (
        <>
          <h1>Ask A.I.R. about Eddie&rsquo;s work</h1>
          <p className="font-body text-lg">
            It answers from Eddie&rsquo;s written work &mdash; the résumé, the
            project write-ups, the stories behind them &mdash; and tells you
            when it can&rsquo;t.
          </p>
        </>
      )}

      {/*
        The card chrome belongs to the page variant only: inside the dialog the
        panel is already a `surface`, and a second one draws a card inside a
        card.
      */}
      <div className={variant === 'page' ? 'surface mt-6 p-4 sm:p-6' : ''}>
        <label
          htmlFor="air-input"
          className="mb-2 block font-body font-semibold"
        >
          {hasCode ? 'Ask a question' : 'Access code'}
        </label>
        {/*
          One field, two modes, keyed on whether a code is stored. The
          placeholder is what signals the shift — a second field or a mode
          toggle would both be more machinery than the state warrants, and a
          visitor who has a code should never see the access UI at all.
        */}
        <input
          id="air-input"
          ref={inputRef}
          type={hasCode ? 'text' : 'password'}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="w-full rounded-lg border border-hairline bg-surface p-3 text-dark focus:outline-2 focus:outline-offset-2 focus:outline-underline dark:border-hairline-dark dark:bg-surface-dark dark:text-light dark:focus:outline-link"
          placeholder={
            hasCode ? "Ask about Eddie's work…" : 'Enter your access code'
          }
          autoComplete="off"
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            if (hasCode) {
              ask(draft);
            } else {
              const code = draft.trim();
              if (!code) return;
              storeCode(code);
              setAccessCode(code);
            }
            setDraft('');
          }}
        />
        <p className="mt-2 font-body text-sm opacity-70">
          {hasCode
            ? 'Press Enter to ask.'
            : 'Press Enter to save it on this device.'}
        </p>

        {/*
          Hidden once a code is stored, so a returning visitor never sees the
          access machinery. It sits here rather than on /cv/ because this is
          where a code is actually needed, and "hides when one is stored" only
          reads correctly beside the field whose mode it describes.
        */}
        {!hasCode && (
          <button
            type="button"
            onClick={() => setRequesting(true)}
            className="mt-2 font-body text-sm underline decoration-underline underline-offset-4 dark:decoration-link"
          >
            Don&rsquo;t have a code? Ask Eddie for access
          </button>
        )}

        {/*
          One container, two contents. Picking a suggestion or asking a question
          swaps what is inside it rather than revealing a second panel below.

          `sm:min-h-80` is the floor: it fits the suggestions, so the swap does
          not resize the dialog under the reader's cursor. It starts at `sm`
          deliberately — a 320px floor inside a panel that cannot scroll would
          push content past the bottom of a landscape phone with no way to
          reach it, and a floor exists only to stop a jump, while a ceiling
          keeps content reachable. Reachability wins where they conflict.

          `max-h-[50dvh]` with `overflow-y-auto` is the ceiling: a long answer
          with sources grows the box until it reaches the available screen
          height and then scrolls inside itself. Only this region scrolls — the
          input above stays put, so a follow-up question never requires
          scrolling back to find the field.

          `flex-1 min-h-0` is what makes that possible at all. The dialog panel
          is a flex column with `overflow-hidden`; a flex child's default
          `min-height: auto` refuses to shrink below its content, so without
          `min-h-0` this box would grow past the panel and be clipped rather
          than scroll.
        */}
        <div
          data-testid="air-body"
          aria-live="polite"
          aria-busy={pending}
          className="mt-6 flex-1 min-h-0 max-h-[50dvh] overflow-y-auto sm:min-h-80"
        >
          {pending && (
            <p className="font-body opacity-70">Reading through Eddie&rsquo;s work&hellip;</p>
          )}

          {!pending && error && <p className="font-body">{error}</p>}

          {!pending && !error && !answer && (
            <>
              <p className="mb-2 font-body text-sm font-semibold">Not sure where to start?</p>
              <ul className="flex list-none flex-col gap-2 pl-0">
                {SUGGESTED.map((item) => (
                  <li key={item.question}>
                    <button
                      type="button"
                      disabled={pending || !hasCode}
                      onClick={() => ask(item.question)}
                      className="w-full rounded-lg border border-hairline p-3 text-left transition-colors hover:border-underline disabled:opacity-50 dark:border-hairline-dark dark:hover:border-link"
                    >
                      <span className="badge">{item.audience}</span>
                      <span className="mt-2 block font-body">{item.question}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {!pending && answer && (
            <div>
              <h2 className="mb-3 font-body text-xl no-underline decoration-0">{question}</h2>

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
                  <p className="mb-2 font-body text-sm font-semibold">Drawn from</p>
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
                  No sources &mdash; this answer isn&rsquo;t grounded in Eddie&rsquo;s written
                  work, so treat it as a gap rather than an assessment.
                </p>
              )}

              {/* Rating on a grounded answer, dispute on a decline — the
                component picks, so the two signals never share a control.
                Absent without a trace id, since feedback with nothing to
                attach to is worse than none. */}
              {answer.traceId && (
                <AnswerFeedback
                  grounded={answer.grounded}
                  traceId={answer.traceId}
                />
              )}

              <button
                type="button"
                onClick={() => {
                  setAnswer(null);
                  setError(null);
                }}
                className="mt-4 font-body text-sm underline decoration-underline underline-offset-4 dark:decoration-link"
              >
                Ask something else
              </button>
            </div>
          )}
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
    </section>
  );
}

export default AIResume;
