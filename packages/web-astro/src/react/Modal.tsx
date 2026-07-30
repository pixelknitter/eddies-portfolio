import React from 'react';

/**
 * A real modal dialog.
 *
 * The A.I.R. request form previously carried `role="dialog"` and
 * `aria-modal="true"` on a div rendered inline in the document flow. That is
 * worse than no ARIA at all: `aria-modal` tells assistive technology that
 * everything outside the dialog is inert, while Tab, the scroll wheel and the
 * pointer all still reached the page behind it. It also meant the form stacked
 * below the panel that opened it, so on a phone the thing you just opened was
 * off screen.
 *
 * Implemented here rather than pulled from a library because the whole point of
 * this page is a small client bundle on a latency-sensitive runtime, and the
 * behaviour a dialog actually owes the user is short: contain focus, close on
 * Escape, close on backdrop, restore focus, and stop the page behind it from
 * scrolling.
 */

/** Elements that can hold focus, for containing Tab inside the dialog. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Id of the heading that names the dialog, for `aria-labelledby`. */
  titleId: string;
  children: React.ReactNode;
}

export function Modal({ open, onClose, titleId, children }: Props) {
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

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
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
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      {/* Backdrop. A separate element so a click on it closes without the panel's
          own clicks bubbling out and dismissing what the user is filling in. */}
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 w-full h-full bg-dark/70 motion-safe:animate-[fade-in_150ms_ease-out] cursor-default"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // max-h with overflow so a long form stays reachable on a short
        // viewport — the failure mode of a centred fixed panel is a submit
        // button below the fold with no way to scroll to it.
        className="relative surface w-full sm:max-w-xl max-h-[92dvh] overflow-y-auto p-4 sm:p-6 rounded-t-2xl sm:rounded-2xl motion-safe:animate-[fade-in_150ms_ease-out]"
      >
        {children}
      </div>
    </div>
  );
}

export default Modal;
