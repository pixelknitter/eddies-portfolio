import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AskAir from './AskAir';

/**
 * The control is a real link that JavaScript upgrades. Without JS a visitor
 * follows it to /cv/air/ and gets the full page; with JS it opens the dialog
 * and never navigates. Both halves are asserted here because the no-JS path has
 * no other test — a plain <button> would pass every interaction test and leave
 * the page unreachable.
 */
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('AskAir', () => {
  it('is a link to the standalone page before JavaScript upgrades it', () => {
    render(<AskAir href="/cv/air/" />);
    expect(screen.getByRole('link', { name: /ask A\.I\.R\./i })).toHaveAttribute(
      'href',
      '/cv/air/',
    );
  });

  /**
   * WCAG 2.1 SC 3.2.1 (On Focus, Level A): receiving focus must not initiate a
   * change of context, and opening a focus-trapping dialog is one. Tabbing past
   * this control must leave the page alone — otherwise a keyboard visitor
   * scanning the résumé is dropped inside a dialog they never asked for, with
   * no way to tab back out because `aria-modal` makes the page behind inert.
   */
  it('does not open when focus merely passes through it', async () => {
    const user = userEvent.setup();
    render(<AskAir href="/cv/air/" />);

    await user.tab();
    expect(screen.getByRole('link', { name: /ask A\.I\.R\./i })).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens on Enter, so a keyboard visitor can reach it deliberately', async () => {
    const user = userEvent.setup();
    render(<AskAir href="/cv/air/" />);

    await user.tab();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('does not navigate when it opens the dialog', async () => {
    const user = userEvent.setup();
    render(<AskAir href="/cv/air/" />);

    const link = screen.getByRole('link', { name: /ask A\.I\.R\./i });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
  });

  /**
   * The keycap on the trigger promises a shortcut that works from anywhere.
   * These assert the promise is kept — and that it is kept without stealing
   * keystrokes from anything else on the page.
   */
  it('opens from anywhere on the page with the modifier shortcut', async () => {
    const user = userEvent.setup();
    render(<AskAir href="/cv/air/" />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Focus deliberately nowhere near the trigger.
    document.body.focus();
    await user.keyboard('{Meta>}k{/Meta}');

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
  });

  it('also answers to Ctrl for anyone not on a Mac', async () => {
    const user = userEvent.setup();
    render(<AskAir href="/cv/air/" />);

    await user.keyboard('{Control>}k{/Control}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
  });

  it('leaves an unmodified k alone, so typing is never hijacked', async () => {
    const user = userEvent.setup();
    render(<AskAir href="/cv/air/" />);

    await user.keyboard('k');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('describes the shortcut for a screen reader, which cannot read a keycap', () => {
    render(<AskAir href="/cv/air/" />);

    const link = screen.getByRole('link', { name: /ask A\.I\.R\./i });
    const describedBy = link.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toMatch(
      /plus K from anywhere/i,
    );
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<AskAir href="/cv/air/" />);

    await user.click(screen.getByRole('link', { name: /ask A\.I\.R\./i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
