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

/**
 * Every open dialog, innermost last.
 *
 * Dialogs nest here: the access-request form renders inside the ask dialog, and
 * `Modal` does not portal, so the inner panel is a DOM descendant of the outer
 * one. Both then listen for `keydown` on `document`, and a listener on the same
 * node cannot be stopped by `stopPropagation` — so without this, Escape in the
 * request form closed the ask dialog too and discarded what had been typed, and
 * Tab off the form's last field landed on the input *behind* it, in the region
 * `aria-modal` promises is inert.
 *
 * Module scope rather than context because it must be shared across every
 * `Modal` regardless of where it is mounted, and there is only ever one
 * document to arbitrate over.
 */
const OPEN_STACK: object[] = [];

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
  /**
   * Distance from the top of the viewport to open at, in pixels.
   *
   * Omit to centre, which suits a dialog with no origin on the page. The ask
   * dialog passes the top edge of the control that opened it, so the dialog
   * appears where that control is rather than in the middle of the screen —
   * the difference between an input opening out and an unrelated panel
   * arriving over the page.
   *
   * The panel is shifted up by the distance from its own top edge to the
   * element marked `data-anchor-align`, if one exists — so it is that element
   * that lands on `anchorTop`, not the panel's corner. For the ask dialog that
   * element is the input, which means the dialog's field opens exactly over the
   * field that was clicked. Aligning the panel's corner instead put the
   * dialog's input a heading and a label below the one it replaced, which is
   * the mismatch that made the two read as different controls.
   *
   * Ignored below `sm`, where the dialog is a bottom sheet within thumb reach
   * and matching a control near the top of the page would put it out of it.
   */
  anchorTop?: number;
  children: React.ReactNode;
}

export function Modal({
  open,
  onClose,
  titleId,
  bodyScrolls = true,
  surface = true,
  widthClass = 'sm:max-w-xl',
  anchorTop,
  children,
}: Props) {
  const panelRef = React.useRef<HTMLDivElement>(null);

  /**
   * How far the anchored element sits below the panel's top edge.
   *
   * Measured in a layout effect rather than assumed, because it is the height
   * of whatever the caller puts above it — a heading, a label, a hint line —
   * and that is not knowable from here. Layout, not passive: it runs before
   * paint, so the panel is never seen at the uncorrected position.
   */
  const [alignOffset, setAlignOffset] = React.useState(0);

  React.useLayoutEffect(() => {
    if (!open || anchorTop === undefined) return;
    const panel = panelRef.current;
    const target = panel?.querySelector<HTMLElement>('[data-anchor-align]');
    if (!panel || !target) return;

    /*
     * Corrects against where the target actually landed, rather than computing
     * where it ought to land.
     *
     * The panel is positioned by a margin inside a padded flex container, so
     * its offset from the viewport is not the margin alone — the container's
     * own padding is in there too, and hard-coding that would break the moment
     * the padding changed. Measuring the residual and folding it back in gets
     * the same answer without the dialog needing to know anything about its
     * wrapper. It converges in one pass, and the sub-pixel guard stops it
     * oscillating on fractional layouts.
     */
    const residual = target.getBoundingClientRect().top - anchorTop;
    if (Math.abs(residual) < 1) return;
    setAlignOffset((previous) => previous + residual);
  }, [open, anchorTop, alignOffset]);

  // Remember what had focus so it can be handed back on close. Without this,
  // dismissing the dialog drops focus to the top of the document and a keyboard
  // user has to tab all the way back to where they were.
  const restoreTo = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open) return;

    restoreTo.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    // Claim the top of the stack for as long as this dialog is open.
    const token = {};
    OPEN_STACK.push(token);
    const isTopmost = () => OPEN_STACK[OPEN_STACK.length - 1] === token;

    // The page behind must not scroll. Restoring the previous value rather than
    // clearing it keeps this safe if anything else is also managing overflow.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKeyDown(event: KeyboardEvent) {
      // Only the dialog on top acts. Both instances listen on `document`, where
      // `stopPropagation` cannot separate them — it stops the event travelling
      // between nodes, not between two listeners on the same node — and the
      // outer one registered first, so it would otherwise win.
      if (!isTopmost()) return;

      if (event.key === 'Escape') {
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
      // Spliced by identity, not popped: a nested dialog can outlive its
      // parent if the parent is closed programmatically, and popping would
      // then remove the wrong token and leave a live dialog deaf to Escape.
      const at = OPEN_STACK.indexOf(token);
      if (at !== -1) OPEN_STACK.splice(at, 1);
      document.body.style.overflow = previousOverflow;
      restoreTo.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      // Fills the viewport and centres the panel; `items-end sm:items-center`
      // puts it within thumb reach on a phone and centres it on a desktop.
      className={`fixed inset-0 z-50 flex items-end justify-center p-0 sm:p-4 ${
        anchorTop === undefined ? 'sm:items-center' : 'sm:items-start'
      }`}
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
        /*
          A CSS custom property rather than a Tailwind class, because the value
          is measured at open time and there is no utility for "wherever that
          control happens to be". Only consulted at `sm` and up — see anchorTop.
        */
        style={
          anchorTop === undefined
            ? undefined
            : ({
                // Never negative: a dialog pulled above the viewport would put
                // its own heading out of reach to align a field.
                '--anchor-top': `${Math.max(0, anchorTop - alignOffset)}px`,
              } as React.CSSProperties)
        }
        // max-h with overflow so a long form stays reachable on a short
        // viewport — the failure mode of a centred fixed panel is a submit
        // button below the fold with no way to scroll to it.
        className={`relative flex max-h-[92dvh] w-full flex-col motion-safe:animate-[lift-in_180ms_ease-out] ${widthClass} ${
          anchorTop === undefined ? '' : 'sm:mt-[var(--anchor-top)]'
        } ${
          surface ? 'surface rounded-t-2xl p-4 sm:rounded-2xl sm:p-6' : ''
        } ${bodyScrolls ? 'overflow-y-auto' : 'overflow-hidden'}`}
      >
        {children}
      </div>
    </div>
  );
}

export default Modal;
