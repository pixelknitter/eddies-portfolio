import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AIResume } from './AIResume';

describe('AIResume', () => {
  it('renders the welcome heading and prompt input', () => {
    render(<AIResume />);
    expect(
      screen.getByRole('heading', { name: /Welcome to A\.I\.R\.!/i })
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/something you want to know about Eddie/i)
    ).toBeInTheDocument();
  });

  it('echoes the question back after pressing Enter', async () => {
    const user = userEvent.setup();
    render(<AIResume />);

    const input = screen.getByPlaceholderText(
      /something you want to know about Eddie/i
    );
    await user.type(input, "What's your experience?{Enter}");

    expect(screen.getByText("What's your experience?")).toBeInTheDocument();
  });
});
