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
 * The `⌘K` hint carries its share of the work: it tells a sighted visitor that
 * this is a control to press rather than a box to type in, which is the one
 * thing the search-field styling does not say on its own. It read `⏎` first,
 * which was true only of the focused control — and a keycap on a search field
 * is read as a shortcut that works from anywhere, because that is what every
 * other search field carrying one means. The promise came before the feature;
 * the shortcut below is the feature catching up.
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
  const triggerRef = React.useRef<HTMLAnchorElement>(null);
  /**
   * Where the trigger was when it was activated.
   *
   * Measured rather than assumed: the control's distance from the top of the
   * viewport depends on how far the visitor has scrolled, so a fixed offset
   * would only be right at the top of the page. Opening the dialog anywhere
   * else is what made it read as an unrelated panel arriving over the résumé
   * rather than this input opening out.
   */
  const [anchorTop, setAnchorTop] = React.useState<number | undefined>();

  const openDialog = React.useCallback((event?: React.SyntheticEvent) => {
    event?.preventDefault();
    const top = triggerRef.current?.getBoundingClientRect().top;
    // Clamped so a trigger scrolled near the bottom does not open a dialog
    // with no room beneath it.
    if (typeof top === 'number') {
      setAnchorTop(Math.max(0, Math.min(top, window.innerHeight * 0.25)));
    }
    setOpen(true);
  }, []);

  // Stable, because Modal has it as an effect dependency and that effect's
  // cleanup restores focus to the trigger. A fresh identity each render would
  // re-run it on any future re-render while open, bouncing focus out of the
  // dialog and back in mid-sentence.
  const closeDialog = React.useCallback(() => setOpen(false), []);

  /**
   * `⌘K` / `Ctrl+K` from anywhere on the page.
   *
   * The keycap hint used to read `⏎`, which is what the control responds to
   * once focused — but a chip on a search field is read as a *global*
   * shortcut, because that is what every search field carrying one means. It
   * promised something it did not do. This makes the promise true rather than
   * withdrawing it.
   *
   * `K` with a modifier rather than a bare key: `/` and bare letters are
   * characters someone may be typing into the résumé's own controls, and a
   * shortcut that steals keystrokes from a text field is worse than no
   * shortcut. The modifier combination is unambiguous even mid-sentence.
   */
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'k' && event.key !== 'K') return;
      if (!event.metaKey && !event.ctrlKey) return;
      // Already open: let the dialog's own handlers have it.
      if (open) return;
      event.preventDefault();
      openDialog();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, openDialog]);

  /**
   * `⌘` on Apple platforms, `Ctrl` everywhere else.
   *
   * Set in an effect rather than during render: this island is server-rendered,
   * where there is no navigator, and branching on it during render would make
   * the first client render disagree with the server's HTML. The server's guess
   * is the majority case for this audience, and it is corrected on mount.
   */
  const [modifier, setModifier] = React.useState('⌘');
  React.useEffect(() => {
    const apple = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
    if (!apple) setModifier('Ctrl ');
  }, []);

  return (
    <>
      <a
        ref={triggerRef}
        href={href}
        onClick={openDialog}
        aria-describedby="air-shortcut-hint"
        className="flex w-full items-center gap-2 rounded-lg border border-hairline bg-surface p-3 text-left font-body no-underline transition-colors hover:border-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-underline dark:border-hairline-dark dark:bg-surface-dark dark:hover:border-link dark:focus-visible:outline-link"
      >
        <span aria-hidden="true">✦</span>
        <span className="opacity-70">Ask A.I.R. about Eddie&rsquo;s work&hellip;</span>
        {/*
          Says "press this" in the one place the search-field styling says
          "type here", and names a shortcut that genuinely works from anywhere
          on the page. aria-hidden because the accessible name already reads
          "link, Ask A.I.R. about Eddie's work" — a screen reader announcing a
          keycap after it would be noise, and the shortcut is announced once,
          properly, by the description below.
        */}
        <span
          aria-hidden="true"
          className="ml-auto rounded border border-hairline px-1.5 py-0.5 text-xs whitespace-nowrap opacity-60 dark:border-hairline-dark"
        >
          {modifier}K
        </span>
      </a>

      {/*
        The shortcut, said once and properly. The keycap above is decorative
        punctuation to a screen reader — "⌘K" read aloud is not an
        instruction — so the same information is given here as a sentence and
        attached to the link as its description.
      */}
      <span id="air-shortcut-hint" className="sr-only">
        Press Command or Control plus K from anywhere on this page to ask
        A.I.R. a question.
      </span>

      <Modal
        open={open}
        onClose={closeDialog}
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
        anchorTop={anchorTop}
      >
        <AIResume variant="dialog" titleId="air-dialog-title" />
      </Modal>
    </>
  );
}

export default AskAir;
