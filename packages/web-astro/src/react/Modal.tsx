import React from 'react';

/**
 * A modal dialog: contains focus, closes on Escape and backdrop, restores focus
 * on close, and locks scrolling behind it.
 *
 * Hand-rolled rather than pulled from a library to keep this page's client
 * bundle small — `aria-modal` is a promise about the rest of the page being
 * inert, so the focus containment below is required, not decorative.
 */

/** Elements that can hold focus, for containing Tab inside the dialog. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Id of the heading that names the dialog, for `aria-labelledby`. */
  titleId: string;
  /**
   * Whether the panel itself scrolls. Default `true`, which suits a form.
   *
   * The ask dialog sets `false`: its input must stay put while only the region
   * beneath it scrolls, so that someone reading a long answer can ask the next
   * question without scrolling back up to find the field. A panel that scrolls
   * as a whole cannot offer that.
   */
  bodyScrolls?: boolean;
  /**
   * Whether the panel draws its own card. Default `true`, which suits a form —
   * one dialog, one surface.
   *
   * The ask dialog sets `false` and draws its own: its input and its
   * answer belong to separate containers, and nesting two cards inside a third
   * reads as clutter rather than structure.
   */
  surface?: boolean;
  /**
   * Panel width class. Defaults to `sm:max-w-xl`, which suits a form.
   *
   * The ask dialog widens to match the control that opened it, so the dialog
   * reads as that input lifting off the page rather than as an unrelated box
   * landing on top of it.
   */
  widthClass?: string;
  children: React.ReactNode;
}

export function Modal({
  open,
  onClose,
  titleId,
  bodyScrolls = true,
  surface = true,
  widthClass = 'sm:max-w-xl',
  children,
}: Props) {
  const panelRef = React.useRef<HTMLDivElement>(null);

  // Remember what had focus so it can be handed back on close. Without this,
  // dismissing the dialog drops focus to the top of the document and a keyboard
  // user has to tab all the way back to where they were.
  const restoreTo = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open) return;

    restoreTo.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    // The page behind must not scroll. Restoring the previous value rather than
    // clearing it keeps this safe if anything else is also managing overflow.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !panel) return;

      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      // Wrap at both ends, so Tab and Shift+Tab cycle within the dialog instead
      // of escaping to the browser chrome or the page behind.
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreTo.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      // Fills the viewport and centres the panel; `items-end sm:items-center`
      // puts it within thumb reach on a phone and centres it on a desktop.
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
    >
      {/* Backdrop. A separate element so a click on it closes without the panel's
          own clicks bubbling out and dismissing what the user is filling in. */}
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-dark/70 motion-safe:animate-[fade-in_150ms_ease-out]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // max-h with overflow so a long form stays reachable on a short
        // viewport — the failure mode of a centred fixed panel is a submit
        // button below the fold with no way to scroll to it.
        className={`relative flex max-h-[92dvh] w-full flex-col motion-safe:animate-[lift-in_180ms_ease-out] ${widthClass} ${
          surface ? 'surface rounded-t-2xl p-4 sm:rounded-2xl sm:p-6' : ''
        } ${bodyScrolls ? 'overflow-y-auto' : 'overflow-hidden'}`}
      >
        {children}
      </div>
    </div>
  );
}

export default Modal;
