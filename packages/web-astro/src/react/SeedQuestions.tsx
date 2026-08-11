import React from 'react';

import Modal from './Modal';
import { useReducedMotion } from './useReducedMotion';
import { AIResume } from './AIResume';

/**
 * Lane-tagged seed questions on the CV chooser.
 *
 * ## What this is for
 *
 * The cards above ask a visitor to classify themselves by job title, which is a
 * question some people cannot answer about a role they are hiring for. A
 * question they recognise is easier to point at than a category, so these are a
 * second door into the same building: pick the thing you are actually trying to
 * find out, and the answer arrives already framed for the lane it came from.
 *
 * ## Why they rotate
 *
 * Each lane has more questions than fit on a chooser, and showing three per
 * lane at once turns a prompt into a menu. Rotating shows the breadth without
 * spending the space.
 *
 * It stops entirely under `prefers-reduced-motion`. The rotation is decoration,
 * and someone who has asked the system to stop moving things has asked for this
 * too. The first question in each lane is the one that stays, so nothing is
 * hidden behind an animation that never runs.
 *
 * ## Why the flip has two phases
 *
 * The text used to swap in full view, which read as a stutter rather than a
 * change. The card now turns edge-on, swaps while it cannot be read, and
 * returns from the opposite side — so the movement explains the new text
 * instead of interrupting the old one. `motion.css` owns the keyframes.
 *
 * ## Why it pauses
 *
 * Rotation stops on hover, on focus, and while the dialog is open. A question
 * that flips away as someone reaches for it is worse than one that never
 * moved — they now have to find it again, and it is the reason WCAG 2.2.2 asks
 * for a way to stop moving content at all. Pausing on the interaction that
 * precedes a click is that mechanism, and it costs the visitor nothing to
 * discover.
 *
 * ## Why a picked question is prefilled and not sent
 *
 * The visitor chose a starting point, not a final wording. Sending it for them
 * removes the edit they may want to make, and makes the first model call
 * something the page did rather than something they did.
 */

interface Seed {
  audience: string;
  question: string;
  lane: string;
}

interface Props {
  /** Questions by lane, in the order the lanes should appear. */
  seeds: Record<string, Seed[]>;
}

/** Long enough to read a question and decide it is not the one. */
const ROTATE_MS = 7000;

/**
 * How long the card takes to turn edge-on, and therefore when the text may be
 * swapped without anyone seeing it happen.
 *
 * Must match `flip-out` in motion.css. Duplicated because CSS and JS cannot
 * share a constant, and the failure is visible rather than subtle: too short
 * and the text changes in view, too long and the card sits blank.
 */
const FLIP_OUT_MS = 170;

/** `idle` renders no animation at all, so nothing flips on first paint. */
type Phase = 'idle' | 'out' | 'in';

export function SeedQuestions({ seeds }: Props) {
  const lanes = React.useMemo(
    () => Object.keys(seeds).filter((lane) => (seeds[lane] ?? []).length > 0),
    [seeds],
  );
  const [tick, setTick] = React.useState(0);
  const [phase, setPhase] = React.useState<Phase>('idle');
  const [hovering, setHovering] = React.useState(false);
  const [asking, setAsking] = React.useState<Seed | null>(null);

  // Shared with Modal, so both halves of the site agree about what the
  // preference means and pick it up if it changes mid-visit.
  const rotates = !useReducedMotion();

  /*
   * Held while someone is looking at a card or reading an answer. The dialog
   * counts: the list is behind it, so rotating spends motion nobody can see and
   * would move the card they came from out from under them on close.
   */
  const held = hovering || asking !== null;

  React.useEffect(() => {
    if (!rotates || held) return;
    const id = setInterval(() => setPhase('out'), ROTATE_MS);
    return () => clearInterval(id);
  }, [rotates, held]);

  /*
   * The swap, timed to land while the card is edge-on. Deliberately not guarded
   * by `held`: a rotation already under way finishes even if the pointer
   * arrives mid-flip, because stopping here would leave the card frozen
   * face-down.
   */
  React.useEffect(() => {
    if (phase !== 'out') return;
    const id = setTimeout(() => {
      setTick((value) => value + 1);
      setPhase('in');
    }, FLIP_OUT_MS);
    return () => clearTimeout(id);
  }, [phase]);

  // Stable, because Modal has it as an effect dependency and that effect's
  // cleanup restores focus to the trigger. A fresh identity each render would
  // re-run it while open, bouncing focus out of the dialog mid-sentence.
  const close = React.useCallback(() => setAsking(null), []);

  /*
   * The last question asked, held through the dialog's exit.
   *
   * `asking` goes null the instant close is pressed, but the panel stays on
   * screen for the length of the sink-out. Rendering on `asking` alone emptied
   * the panel first and then animated the empty shell away, which reads as two
   * separate failures rather than one dismissal.
   */
  const lastAsked = React.useRef<Seed | null>(null);
  if (asking) lastAsked.current = asking;
  const shown = asking ?? lastAsked.current;

  if (lanes.length === 0) return null;

  return (
    <>
      {/*
        Focus handlers on the list rather than each button: `onFocus` bubbles in
        React, so one pair covers every card and keyboard users get the same
        pause a pointer gets. Hover is on the list too, so moving between cards
        does not resume the rotation for the width of the gap between them.
      */}
      <ul
        className="grid list-none gap-3 pl-0 sm:grid-cols-2"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onFocus={() => setHovering(true)}
        onBlur={() => setHovering(false)}
      >
        {lanes.map((lane) => {
          const pool = seeds[lane];
          const seed = pool[tick % pool.length];
          return (
            // `perspective` belongs to the parent of the thing being rotated,
            // or rotateX flattens into a vertical squash with no depth to it.
            <li key={lane} className="[perspective:800px]">
              <button
                type="button"
                data-phase={phase}
                onClick={() => setAsking(seed)}
                /*
                  `min-h` so a one-line question and a two-line one occupy the
                  same box: without it the grid row resizes as the text swaps,
                  and the flip lands on a card that has moved.
                */
                className="seed-card flex min-h-20 w-full items-start gap-2 rounded-lg border border-hairline bg-surface p-3 text-left font-body transition-colors hover:border-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-underline dark:border-hairline-dark dark:bg-surface-dark dark:hover:border-link dark:focus-visible:outline-link"
              >
                <span aria-hidden="true">✦</span>
                <span>{seed.question}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <Modal
        open={asking !== null}
        onClose={close}
        titleId="seed-dialog-title"
        // The input must not scroll away; only the answer region does.
        bodyScrolls={false}
        /*
          The panel draws no card of its own: the island inside draws two, one
          for the input and one for what it produces.
        */
        surface={false}
        widthClass="sm:max-w-3xl"
      >
        {shown && (
          <AIResume
            variant="dialog"
            titleId="seed-dialog-title"
            seed={shown.question}
            role={shown.lane}
          />
        )}
      </Modal>
    </>
  );
}

export default SeedQuestions;
