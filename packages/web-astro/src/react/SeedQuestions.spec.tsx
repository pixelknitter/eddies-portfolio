import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

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

    act(() => {
      vi.advanceTimersByTime(7000);
    });

    expect(screen.getByText('Second product question?')).toBeInTheDocument();
    expect(screen.getByText('Second solutions question?')).toBeInTheDocument();
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
