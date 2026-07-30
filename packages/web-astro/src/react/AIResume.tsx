import React from 'react';

import Modal from './Modal';

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
};

/**
 * Openers aimed at who the visitor probably is. People rarely know what to ask
 * an interactive resume, and a blank box gets a blank response.
 */
const SUGGESTED = [
  { audience: 'Hiring manager', question: 'How does Eddie approach a system nobody wants to own?' },
  { audience: 'Client', question: 'What does Eddie do when the requirements are still moving?' },
  { audience: 'Partner', question: 'How does Eddie work with a team that is not his own?' },
];

export function AIResume() {
  const [accessCode, setAccessCode] = React.useState('');
  const [requesting, setRequesting] = React.useState(false);
  const [requestEmail, setRequestEmail] = React.useState('');
  const [requestReason, setRequestReason] = React.useState('');
  const [requestState, setRequestState] = React.useState<
    { status: 'idle' | 'sending' } | { status: 'sent' | 'failed'; message: string }
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
          : { status: 'failed', message: body.error ?? 'Could not send that. Try again.' }
      );
    } catch {
      setRequestState({ status: 'failed', message: 'Could not reach the site. Try again.' });
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
        headers: { 'content-type': 'application/json', 'x-air-access': accessCode },
        body: JSON.stringify({ question: trimmed }),
      });

      const body = await response.json();

      if (!response.ok) {
        setError(body?.error ?? 'Something went wrong. Try again in a moment.');
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
        The AI-powered Resume. It answers from Eddie&rsquo;s written work &mdash; and tells you when
        it can&rsquo;t.
      </p>

      <div className="surface p-4 sm:p-6 mt-6">
        <label htmlFor="air-access" className="block font-body font-semibold mb-2">
          Access code
        </label>
        <input
          id="air-access"
          type="password"
          value={accessCode}
          onChange={(event) => setAccessCode(event.target.value)}
          className="w-full p-3 rounded-lg bg-light dark:bg-dark text-dark dark:text-light border border-hairline dark:border-hairline-dark focus:outline-2 focus:outline-offset-2 focus:outline-underline dark:focus:outline-link"
          placeholder="The code from the card"
          autoComplete="off"
        />

        <button
          type="button"
          onClick={() => setRequesting(true)}
          className="font-body text-sm underline decoration-underline dark:decoration-link underline-offset-4 mt-2"
        >
          Don&rsquo;t have one? Ask Eddie for access
        </button>

        <label htmlFor="air-question" className="block font-body font-semibold mb-2 mt-6">
          Ask a question
        </label>
        <input
          id="air-question"
          ref={inputRef}
          className="w-full p-3 rounded-lg bg-light dark:bg-dark text-dark dark:text-light border border-hairline dark:border-hairline-dark focus:outline-2 focus:outline-offset-2 focus:outline-underline dark:focus:outline-link"
          placeholder="What's something you want to know about Eddie?"
          onKeyDown={(event) => {
            if (event.key === 'Enter') ask(event.currentTarget.value);
          }}
        />
        <p className="font-body text-sm opacity-70 mt-2">Press Enter to ask.</p>

        <div className="mt-6">
          <p className="font-body text-sm font-semibold mb-2">Not sure where to start?</p>
          <ul className="flex flex-col gap-2 list-none pl-0">
            {SUGGESTED.map((item) => (
              <li key={item.question}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (inputRef.current) inputRef.current.value = item.question;
                    ask(item.question);
                  }}
                  className="text-left w-full p-3 rounded-lg border border-hairline dark:border-hairline-dark hover:border-underline dark:hover:border-link transition-colors disabled:opacity-50"
                >
                  <span className="badge">{item.audience}</span>
                  <span className="block font-body mt-2">{item.question}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <Modal open={requesting} onClose={closeRequest} titleId="air-request-title">
        <div>
          <h2 id="air-request-title" className="font-body text-xl mb-2 no-underline decoration-0">
            Ask for access
          </h2>
          <p className="font-body text-sm opacity-70 mb-4">
            Eddie reads these himself and approves them by hand. Tell him who you are and what
            you&rsquo;re hoping to find out.
          </p>

          <form onSubmit={submitRequest}>
            <label htmlFor="air-request-email" className="block font-body font-semibold mb-2">
              Your email
            </label>
            <input
              id="air-request-email"
              ref={requestEmailRef}
              type="email"
              required
              value={requestEmail}
              onChange={(event) => setRequestEmail(event.target.value)}
              className="w-full p-3 rounded-lg bg-light dark:bg-dark text-dark dark:text-light border border-hairline dark:border-hairline-dark focus:outline-2 focus:outline-offset-2 focus:outline-underline dark:focus:outline-link"
              placeholder="you@company.com"
            />

            <label htmlFor="air-request-reason" className="block font-body font-semibold mb-2 mt-4">
              Why you&rsquo;re reaching out
            </label>
            <textarea
              id="air-request-reason"
              required
              rows={4}
              value={requestReason}
              onChange={(event) => setRequestReason(event.target.value)}
              className="w-full p-3 rounded-lg bg-light dark:bg-dark text-dark dark:text-light border border-hairline dark:border-hairline-dark focus:outline-2 focus:outline-offset-2 focus:outline-underline dark:focus:outline-link"
              placeholder="Hiring for a platform role and wanted to understand how you work."
            />

            <div className="flex flex-wrap gap-3 mt-4">
              <button
                type="submit"
                disabled={requestState.status === 'sending'}
                className="btn px-4 py-2 rounded-lg border border-hairline dark:border-hairline-dark hover:border-underline dark:hover:border-link transition-colors disabled:opacity-50 min-w-36 text-center"
              >
                {requestState.status === 'sending' ? 'Sending…' : 'Send request'}
              </button>
              <button
                type="button"
                onClick={closeRequest}
                className="font-body text-sm underline decoration-underline dark:decoration-link underline-offset-4"
              >
                Cancel
              </button>
            </div>
          </form>

          {/* Height reserved, so a message arriving does not shove the buttons
              up. The 503 from an unconfigured environment returns in well under
              a second, and the shift as "Sending…" swapped back while this
              paragraph mounted was the flicker. */}
          <div aria-live="polite" className="min-h-6 mt-4">
            {/* Tested positively rather than by excluding the other two states:
                the idle member's `status` is itself a union, which TypeScript
                will not narrow away through a pair of !== checks. */}
            {(requestState.status === 'sent' || requestState.status === 'failed') && (
              <p className="font-body">{requestState.message}</p>
            )}
          </div>
        </div>
      </Modal>

      {/* aria-live so an arriving answer is announced, not just painted. */}
      <div aria-live="polite" aria-busy={pending}>
        {pending && <p className="font-body mt-6 opacity-70">Reading through Eddie&rsquo;s work&hellip;</p>}

        {error && (
          <div className="surface p-4 sm:p-6 mt-6">
            <p className="font-body">{error}</p>
          </div>
        )}

        {answer && (
          <div className="surface p-4 sm:p-6 mt-6">
            <h2 className="font-body text-xl mb-3 no-underline decoration-0">{question}</h2>

            {answer.answer
              .split('\n')
              .filter(Boolean)
              .map((paragraph, index) => (
                <p key={index} className="font-body leading-relaxed mb-3">
                  {paragraph}
                </p>
              ))}

            {answer.grounded && answer.sources && answer.sources.length > 0 && (
              <div className="mt-4 pt-4 border-t border-hairline dark:border-hairline-dark">
                <p className="font-body text-sm font-semibold mb-2">Drawn from</p>
                <ul className="flex flex-wrap gap-2 list-none pl-0">
                  {answer.sources.map((source) => (
                    <li key={source.id}>
                      <span className="badge">{source.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!answer.grounded && (
              <p className="font-body text-sm opacity-70 mt-4 pt-4 border-t border-hairline dark:border-hairline-dark">
                No sources &mdash; this answer isn&rsquo;t grounded in Eddie&rsquo;s written work, so
                treat it as a gap rather than an assessment.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export default AIResume;
