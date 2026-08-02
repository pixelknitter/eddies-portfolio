import React from 'react';

import Modal from './Modal';
import { AIResume } from './AIResume';

/**
 * The résumé's front door to A.I.R.
 *
 * Styled as a search field but it is **not a text field** — it is the modal
 * trigger. One input that accepts text lives in the dialog; this one only
 * opens it, so a visitor's keystrokes never land in a control that is about to
 * be replaced.
 *
 * ## Activated, never focused
 *
 * The dialog opens on click or Enter, never on focus. WCAG 2.1 SC 3.2.1
 * (On Focus, Level A) is explicit: a component receiving focus must not
 * initiate a change of context, and opening a focus-trapping dialog is exactly
 * that. A keyboard visitor tabbing down the résumé would otherwise land inside
 * a dialog they never asked for — and could not tab back out of, because
 * `aria-modal="true"` makes the rest of the page inert. That is the whole
 * point of a modal, which is why focus-to-open and modality cannot both hold.
 * Closing on blur instead would trade the trap for a dialog that vanishes
 * mid-sentence. Activation is the only option that is neither.
 *
 * The `⏎` hint carries its share of the work: it tells a sighted visitor that
 * this is a control to press rather than a box to type in, which is the one
 * thing the search-field styling does not say on its own.
 *
 * It is an `<a href>` rather than a `<button>` so the feature works with
 * JavaScript off: the link goes to /cv/air/, which renders the same island as
 * a full page. The upgrade is `preventDefault` on activation. A link is
 * activated by Enter, which is the keyboard behaviour we want anyway.
 */

interface Props {
  /** The standalone page, followed when JavaScript is unavailable. */
  href: string;
}

export function AskAir({ href }: Props) {
  const [open, setOpen] = React.useState(false);

  const openDialog = React.useCallback((event?: React.SyntheticEvent) => {
    event?.preventDefault();
    setOpen(true);
  }, []);

  return (
    <>
      <a
        href={href}
        onClick={openDialog}
        className="flex w-full items-center gap-2 rounded-lg border border-hairline bg-surface p-3 text-left font-body no-underline transition-colors hover:border-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-underline dark:border-hairline-dark dark:bg-surface-dark dark:hover:border-link dark:focus-visible:outline-link"
      >
        <span aria-hidden="true">✦</span>
        <span className="opacity-70">Ask A.I.R. about Eddie&rsquo;s work&hellip;</span>
        {/*
          Says "press this" in the one place the search-field styling says
          "type here". aria-hidden because the accessible name already reads
          "link, Ask A.I.R. about Eddie's work" — a screen reader announcing
          a keycap after it would be noise, not information.
        */}
        <span
          aria-hidden="true"
          className="ml-auto rounded border border-hairline px-1.5 py-0.5 text-xs opacity-60 dark:border-hairline-dark"
        >
          ⏎
        </span>
      </a>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        titleId="air-dialog-title"
        // The input must not scroll away; only the answer region does.
        bodyScrolls={false}
        /*
          The panel draws no card of its own: the island inside draws two, one
          for the input and one for what it produces. A single card wrapping
          both would say they are one thing, and they are not — the field
          persists while its answer is replaced.
        */
        surface={false}
        /*
          Matches the max-w-3xl the trigger sits in on /cv/, so the dialog opens
          at the width of the control that opened it and reads as that input
          lifting off the page rather than a narrower box arriving over it.
        */
        widthClass="sm:max-w-3xl"
      >
        <AIResume variant="dialog" titleId="air-dialog-title" />
      </Modal>
    </>
  );
}

export default AskAir;
