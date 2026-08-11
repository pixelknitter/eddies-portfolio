import React from 'react';

import Modal from './Modal';
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

export function SeedQuestions({ seeds }: Props) {
  const lanes = React.useMemo(
    () => Object.keys(seeds).filter((lane) => (seeds[lane] ?? []).length > 0),
    [seeds],
  );
  const [tick, setTick] = React.useState(0);
  const [asking, setAsking] = React.useState<Seed | null>(null);

  /**
   * Read the motion preference in an effect, not during render.
   *
   * This island is server-rendered, where there is no `matchMedia`, and
   * branching on it during render would make the first client render disagree
   * with the server's HTML. Starting at `false` also means the still version is
   * what renders first, so rotation is something that begins rather than
   * something that has to be stopped.
   */
  const [rotates, setRotates] = React.useState(false);
  React.useEffect(() => {
    setRotates(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  React.useEffect(() => {
    if (!rotates) return;
    const id = setInterval(() => setTick((value) => value + 1), ROTATE_MS);
    return () => clearInterval(id);
  }, [rotates]);

  // Stable, because Modal has it as an effect dependency and that effect's
  // cleanup restores focus to the trigger. A fresh identity each render would
  // re-run it while open, bouncing focus out of the dialog mid-sentence.
  const close = React.useCallback(() => setAsking(null), []);

  if (lanes.length === 0) return null;

  return (
    <>
      <ul className="grid list-none gap-3 pl-0 sm:grid-cols-2">
        {lanes.map((lane) => {
          const pool = seeds[lane];
          const seed = pool[tick % pool.length];
          return (
            <li key={lane}>
              <button
                type="button"
                onClick={() => setAsking(seed)}
                className="flex w-full items-start gap-2 rounded-lg border border-hairline bg-surface p-3 text-left font-body transition-colors hover:border-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-underline dark:border-hairline-dark dark:bg-surface-dark dark:hover:border-link dark:focus-visible:outline-link"
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
        {asking && (
          <AIResume
            variant="dialog"
            titleId="seed-dialog-title"
            seed={asking.question}
            role={asking.lane}
          />
        )}
      </Modal>
    </>
  );
}

export default SeedQuestions;
