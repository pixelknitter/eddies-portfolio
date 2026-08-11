import { useEffect, useRef, useState } from 'react';

import { EVENTS } from '@pk/telemetry/events';
import { ensureClient, getClient } from '../util/telemetry/client.mjs';
import { DEFAULT_VARIANT } from '../util/resume/variants.mjs';

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

interface Props {
  /**
   * Which CV this bar belongs to.
   *
   * Sent with the request so the issued token names the variant, and the
   * download endpoint can refuse a token minted for a different document. The
   * visitor never sees it: they asked for the CV they are reading.
   */
  variant?: string;
}

export function ResumeDownload({ variant = DEFAULT_VARIANT }: Props = {}) {
  const [wanted, setWanted] = useState<Wanted | null>(null);
  const [state, setState] = useState<State>({ status: 'idle' });
  const emailRef = useRef<HTMLInputElement>(null);

  // Move focus into the form when it opens, so a keyboard user is not left where
  // the button used to be.
  useEffect(() => {
    if (wanted) emailRef.current?.focus();
  }, [wanted]);

  /**
   * Opening the form is the first funnel step, and the first point at which
   * this page needs telemetry at all.
   *
   * `ensureClient` is fire-and-forget: in feedback-only mode the layout has not
   * loaded the SDK, and the capture below is queued by the façade and replayed
   * once it arrives. Nothing is lost while it resolves, and nothing waits on it.
   */
  function openForm(which: Wanted) {
    void ensureClient();
    getClient().capture(EVENTS.resumeFormOpened);
    setWanted(which);
  }

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
        body: JSON.stringify({ email, reason, format: wanted, variant }),
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
      /*
       * Counted once per submission, not once per file. Two files leave here
       * on a human request, and a funnel step that increments twice for one
       * visitor's action is a funnel that lies.
       *
       * No properties, deliberately: this component's own props are the one
       * place on the site where a token decoding to an email is in scope, so
       * the event carries the step and nothing else.
       */
      getClient().capture(EVENTS.resumeDownloadTriggered);

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
    /*
      `w-full`, because this island is a flex child of `.resume-action-bar`.
      Without it the island sizes to its content, so the confirmation panel and
      the form ended up narrower than the buttons above them and narrower than
      the ask row below — three controls in one column, none of them agreeing
      on where that column ends. Full width settles everything on the bar's own
      measure.
    */
    <div className="w-full font-body">
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
          onClick={() => {
            openForm('human');
          }}
        >
          <span aria-hidden="true">⤓</span> Human readable
        </button>
        <button
          type="button"
          className="resume-cta resume-cta-secondary"
          onClick={() => {
            openForm('bot');
          }}
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
        {/*
          A refusal is nudged rather than popped: it is not an arrival to
          celebrate, and the shake is transform-only so the form beneath it does
          not move. `a rejected request reports why without shifting the layout`
          is an e2e test, and a layout-affecting shake would fail it correctly.
        */}
        {state.status === 'failed' && (
          <p className="motion-nudge surface mt-4 p-4 text-sm">
            {state.message}
          </p>
        )}

        {/* The one moment in this flow worth a small overshoot. */}
        {state.status === 'sent' && (
          <div className="motion-pop-in surface mt-4 p-4">
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
