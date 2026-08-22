import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

import { SeedQuestions } from './SeedQuestions';

const seeds = {
  product: [
    {
      audience: 'Hiring manager',
      question: 'First product question?',
      lane: 'product',
    },
    { audience: 'Client', question: 'Second product question?', lane: 'product' },
  ],
  solutions: [
    {
      audience: 'Partner',
      question: 'First solutions question?',
      lane: 'solutions',
    },
    {
      audience: 'Sales engineer',
      question: 'Second solutions question?',
      lane: 'solutions',
    },
  ],
};

function mockMotionPreference(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced && query.includes('reduce'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  }));
}

describe('SeedQuestions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockMotionPreference(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows one question per lane', () => {
    render(<SeedQuestions seeds={seeds} />);

    expect(screen.getByText('First product question?')).toBeInTheDocument();
    expect(screen.getByText('First solutions question?')).toBeInTheDocument();
    expect(
      screen.queryByText('Second product question?'),
    ).not.toBeInTheDocument();
  });

  it('rotates to the next question in each lane', () => {
    render(<SeedQuestions seeds={seeds} />);

    // The interval starts the flip; the text swaps a beat later, while the card
    // is edge-on. Advancing only to the interval would assert the old text.
    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(screen.getByText('First product question?')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText('Second product question?')).toBeInTheDocument();
    expect(screen.getByText('Second solutions question?')).toBeInTheDocument();
  });

  // The swap has to be invisible. If the card is not edge-on when the text
  // changes, this is the stiff jump the flip was added to remove.
  it('turns the card away before the text changes', () => {
    render(<SeedQuestions seeds={seeds} />);

    act(() => {
      vi.advanceTimersByTime(7000);
    });

    const card = screen.getByText('First product question?').closest('button');
    expect(card).toHaveAttribute('data-phase', 'out');

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(
      screen.getByText('Second product question?').closest('button'),
    ).toHaveAttribute('data-phase', 'in');
  });

  it('renders no animation on first paint', () => {
    render(<SeedQuestions seeds={seeds} />);
    expect(
      screen.getByText('First product question?').closest('button'),
    ).toHaveAttribute('data-phase', 'idle');
  });

  /*
   * A question that flips away as someone reaches for it is worse than one that
   * never moved: they now have to find it again. This is the WCAG 2.2.2
   * mechanism, on the interaction that precedes a click.
   */
  it('stops rotating while the pointer is over the list', () => {
    render(<SeedQuestions seeds={seeds} />);
    const list = screen.getByRole('list');

    act(() => {
      fireEvent.mouseEnter(list);
      vi.advanceTimersByTime(21000);
    });

    expect(screen.getByText('First product question?')).toBeInTheDocument();
  });

  it('resumes once the pointer leaves', () => {
    render(<SeedQuestions seeds={seeds} />);
    const list = screen.getByRole('list');

    act(() => {
      fireEvent.mouseEnter(list);
      vi.advanceTimersByTime(21000);
      fireEvent.mouseLeave(list);
    });
    act(() => {
      vi.advanceTimersByTime(7200);
    });

    expect(screen.getByText('Second product question?')).toBeInTheDocument();
  });

  // Keyboard users get the same pause a pointer gets.
  it('stops rotating while a card has focus', () => {
    render(<SeedQuestions seeds={seeds} />);

    act(() => {
      fireEvent.focus(screen.getByText('First product question?').closest('button')!);
      vi.advanceTimersByTime(21000);
    });

    expect(screen.getByText('First product question?')).toBeInTheDocument();
  });

  /*
   * Rotation is decoration. Someone who has asked the system to stop moving
   * things has asked for this too, and the first question in each lane is the
   * one that stays — so nothing is hidden behind an animation that never runs.
   */
  it('does not rotate when reduced motion is preferred', () => {
    mockMotionPreference(true);
    render(<SeedQuestions seeds={seeds} />);

    act(() => {
      vi.advanceTimersByTime(21000);
    });

    expect(screen.getByText('First product question?')).toBeInTheDocument();
    expect(
      screen.queryByText('Second product question?'),
    ).not.toBeInTheDocument();
  });

  it('offers each visible question as its own button', () => {
    render(<SeedQuestions seeds={seeds} />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('renders nothing for a lane with no questions', () => {
    render(<SeedQuestions seeds={{ product: seeds.product, empty: [] }} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  // The dialog is the whole point: a seed that opens nothing is a dead button.
  it('opens the dialog on the question that was picked', () => {
    render(<SeedQuestions seeds={seeds} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    act(() => {
      screen.getByText('First solutions question?').closest('button')?.click();
    });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
