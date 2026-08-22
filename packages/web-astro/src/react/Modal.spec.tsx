import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

import Modal from './Modal';

/**
 * The dialog's exit.
 *
 * Its entrance, focus trap and scroll lock are exercised end to end in
 * `air.spec.ts` against a real browser. What cannot be asserted there without
 * timing games is the thing this file is for: that the panel outlives `open`
 * for exactly as long as its animation, and not at all when the visitor has
 * asked for no animation.
 */

function motionPreference(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced && query.includes('reduce'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

/** `onClose` is a no-op here: these tests drive `open` directly. */
const noop = vi.fn();

function Dialog({ open }: { open: boolean }) {
  return (
    <Modal open={open} onClose={noop} titleId="t">
      <h2 id="t">A question</h2>
      <button type="button">Inside</button>
    </Modal>
  );
}

describe('Modal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    motionPreference(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders nothing before it is ever opened', () => {
    render(<Dialog open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  /*
   * The whole point. Unmounting on `open === false` is what made dismissal
   * abrupt: the dialog ceased to exist with no counterpart to the lift it
   * arrived on.
   */
  it('keeps the panel mounted while it runs out', () => {
    const view = render(<Dialog open />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    view.rerender(<Dialog open={false} />);
    // `hidden: true` because the shell is aria-hidden while it runs out — the
    // panel is on screen but deliberately out of the accessibility tree.
    expect(screen.getByRole('dialog', { hidden: true })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(
      screen.queryByRole('dialog', { hidden: true }),
    ).not.toBeInTheDocument();
  });

  it('runs the panel out rather than fading the whole overlay', () => {
    const view = render(<Dialog open />);
    view.rerender(<Dialog open={false} />);

    const panel = screen.getByRole('dialog', { hidden: true });
    expect(panel.className).toContain('motion-sink-out');
    expect(panel.className).not.toContain('motion-lift-in');
  });

  /*
   * Focus has already gone back to the opener by the time this runs, so hiding
   * the shell traps nobody — and a click landing on the fading backdrop must
   * not reach a dialog that is already closing.
   */
  it('is inert while it runs out', () => {
    const view = render(<Dialog open />);
    view.rerender(<Dialog open={false} />);

    const shell = screen.getByRole('dialog', { hidden: true }).closest('.fixed');
    expect(shell).toHaveAttribute('aria-hidden', 'true');
    expect(shell?.className).toContain('pointer-events-none');
  });

  /*
   * Lingering with no animation to show for it is worse than the abrupt close
   * it replaced, because nothing explains the delay.
   */
  it('closes immediately when reduced motion is preferred', () => {
    motionPreference(true);
    const view = render(<Dialog open />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    view.rerender(<Dialog open={false} />);
    expect(
      screen.queryByRole('dialog', { hidden: true }),
    ).not.toBeInTheDocument();
  });

  it('re-opens cleanly after an exit', () => {
    const view = render(<Dialog open />);
    view.rerender(<Dialog open={false} />);
    act(() => {
      vi.advanceTimersByTime(200);
    });

    view.rerender(<Dialog open />);
    const panel = screen.getByRole('dialog');
    expect(panel.className).toContain('motion-lift-in');
    expect(panel.className).not.toContain('motion-sink-out');
  });

  // Escape and the backdrop are the two ways out; both go through `onClose`.
  it('asks to close on Escape and on a backdrop click', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} titleId="t">
        <h2 id="t">A question</h2>
      </Modal>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
