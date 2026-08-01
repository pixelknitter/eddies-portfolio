import { useEffect, useRef, useState } from 'react';

/**
 * The lead-capture gate on the resume page.
 *
 * Two buttons — "Human Readable" and "Bot Readable" — open one form asking for an
 * address and a line about why. On submit the PDFs are served immediately.
 *
 * ## Why the links are rendered as well as clicked
 *
 * The download is triggered by creating a hidden anchor and clicking it, which is
 * the only way to start a download without navigating away from the page. Browsers
 * block that in some configurations, and they throttle simultaneous programmatic
 * downloads — so the two are fired a beat apart, and the links are *also* rendered
 * visibly. If the click is blocked there is still something to press, rather than a
 * form that appears to have done nothing.
 *
 * ## Only the wrapper is an island
 *
 * The resume itself is server-rendered Astro. This is the one interactive piece, so
 * it is the only thing shipped as JavaScript.
 */

type Download = {
  format: 'human' | 'bot';
  label: string;
  filename: string;
  url: string;
};

type State =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'sent'; downloads: Download[]; message: string }
  | { status: 'failed'; message: string };

/** Which download the form was opened for. */
type Wanted = 'human' | 'bot' | 'both';

const INPUT_CLASS =
  'w-full p-3 rounded-lg bg-surface dark:bg-surface-dark text-dark dark:text-light border border-hairline dark:border-hairline-dark focus:outline-2 focus:outline-offset-2 focus:outline-underline dark:focus:outline-link';

/**
 * Start a download without leaving the page.
 *
 * `download` on the anchor is advisory — the endpoint sends
 * Content-Disposition: attachment, which is what actually decides it.
 */
function triggerDownload(url: string, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function ResumeDownload() {
  const [wanted, setWanted] = useState<Wanted | null>(null);
  const [state, setState] = useState<State>({ status: 'idle' });
  const emailRef = useRef<HTMLInputElement>(null);

  // Move focus into the form when it opens, so a keyboard user is not left where
  // the button used to be.
  useEffect(() => {
    if (wanted) emailRef.current?.focus();
  }, [wanted]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!wanted) return;

    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');
    const reason = String(form.get('reason') ?? '');

    setState({ status: 'sending' });

    try {
      const response = await fetch('/api/resume/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, reason, format: wanted }),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        downloads?: Download[];
        message?: string;
        error?: string;
      };

      if (!response.ok || !body.ok || !body.downloads) {
        setState({
          status: 'failed',
          message: body.error ?? 'Something went wrong. Try again shortly.',
        });
        return;
      }

      setState({
        status: 'sent',
        downloads: body.downloads,
        message: body.message ?? 'Your download is starting.',
      });
      setWanted(null);

      // Staggered: browsers throttle downloads fired in the same tick, and the
      // second one silently never happens.
      body.downloads.forEach((download, index) => {
        window.setTimeout(
          () => triggerDownload(download.url, download.filename),
          index * 400,
        );
      });
    } catch {
      setState({
        status: 'failed',
        message: 'Could not reach the server. Try again shortly.',
      });
    }
  }

  return (
    <div className="font-body">
      {/*
        `resume-cta`, not the site's `.btn`. The unlayered organic stylesheet
        outranks `@layer components`, so `.btn` arrived here stripped of its border
        and its hover — rendering as bold display text that read as a heading
        rather than a control. These carry their own hover, active and focus states.

        Labels shortened: the bar itself says what this is, and "Full Resume —"
        twice was the longest text on the page.
      */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="resume-cta resume-cta-primary"
          onClick={() => setWanted('human')}
        >
          <span aria-hidden="true">⤓</span> Human readable
        </button>
        <button
          type="button"
          className="resume-cta resume-cta-secondary"
          onClick={() => setWanted('bot')}
        >
          <span aria-hidden="true">⤓</span> Bot readable
        </button>
      </div>

      {wanted && (
        <form
          onSubmit={submit}
          className="surface mt-4 flex flex-col gap-3 p-4 sm:p-6"
          aria-label="Request the resume"
        >
          <p className="text-sm">
            The PDFs carry my contact details, so I like to know who is reading
            them. Two fields and the download starts immediately.
          </p>

          <div>
            <label
              htmlFor="resume-email"
              className="mb-1 block text-sm font-semibold"
            >
              Your email
            </label>
            <input
              ref={emailRef}
              id="resume-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@company.com"
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <label
              htmlFor="resume-reason"
              className="mb-1 block text-sm font-semibold"
            >
              Why you&rsquo;re interested
            </label>
            <textarea
              id="resume-reason"
              name="reason"
              required
              minLength={10}
              rows={3}
              placeholder="Hiring for a staff role, curious about the agent platform, …"
              className={INPUT_CLASS}
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              className="resume-cta resume-cta-primary"
              disabled={state.status === 'sending'}
            >
              {state.status === 'sending' ? 'Sending…' : 'Get the PDF'}
            </button>
            <button
              type="button"
              className="resume-cta resume-cta-secondary"
              onClick={() => setWanted(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Announced, because the outcome is the whole point of the interaction. */}
      <div aria-live="polite" aria-busy={state.status === 'sending'}>
        {state.status === 'failed' && (
          <p className="surface mt-4 p-4 text-sm">{state.message}</p>
        )}

        {state.status === 'sent' && (
          <div className="surface mt-4 p-4">
            <p className="text-sm">{state.message}</p>
            {/* The fallback that matters: if the programmatic click was blocked,
                these are still here to press. */}
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {state.downloads.map((download) => (
                <li key={download.format}>
                  <a href={download.url} download={download.filename}>
                    {download.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default ResumeDownload;
