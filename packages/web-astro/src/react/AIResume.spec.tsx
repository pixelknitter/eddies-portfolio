import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AIResume } from './AIResume';

/**
 * The behaviour worth testing here is not that an answer renders — it is that
 * a grounded answer and an ungrounded one are told apart on screen. An answer
 * the system could not support, rendered identically to one it could, is the
 * failure the whole retrieval and verification chain exists to prevent, and a
 * UI that shows them the same way would undo it entirely.
 */

function mockAnswer(body: Record<string, unknown>, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => body });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AIResume', () => {
  beforeEach(() => window.localStorage.clear());

  it('renders the welcome heading and prompt input', () => {
    window.localStorage.setItem('air-access-code', 'conf-2026');
    render(<AIResume />);
    expect(
      screen.getByRole('heading', { name: /Ask A\.I\.R\. about Eddie/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/ask about Eddie's work/i)
    ).toBeInTheDocument();
  });

  it('offers suggested questions for visitors who do not know what to ask', () => {
    render(<AIResume />);
    expect(screen.getByRole('button', { name: /system nobody wants to own/i })).toBeInTheDocument();
  });

  it('asks for a code first when none is stored', () => {
    window.localStorage.clear();
    render(<AIResume />);
    expect(screen.getByPlaceholderText(/enter your access code/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ask Eddie for access/i })).toBeInTheDocument();
  });

  it('accepts questions and hides the access machinery once a code is stored', () => {
    window.localStorage.setItem('air-access-code', 'conf-2026');
    render(<AIResume />);
    expect(screen.getByPlaceholderText(/ask about Eddie's work/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ask Eddie for access/i })).not.toBeInTheDocument();
  });

  it('sends a stored code with the question without asking for it again', async () => {
    window.localStorage.setItem('air-access-code', 'conf-2026');
    const fetchMock = mockAnswer({ grounded: false, answer: 'No.', citations: [] });
    const user = userEvent.setup();
    render(<AIResume />);

    await user.type(
      screen.getByPlaceholderText(/ask about Eddie's work/i),
      'How does he work?{Enter}',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/air/ask',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-air-access': 'conf-2026' }),
      }),
    );
  });

  it('submitting a code stores it and switches the input to questions', async () => {
    window.localStorage.clear();
    const user = userEvent.setup();
    render(<AIResume />);

    await user.type(screen.getByPlaceholderText(/enter your access code/i), 'conf-2026{Enter}');

    expect(window.localStorage.getItem('air-access-code')).toBe('conf-2026');
    expect(screen.getByPlaceholderText(/ask about Eddie's work/i)).toBeInTheDocument();
  });

  it('sends the access code with the question', async () => {
    const fetchMock = mockAnswer({ grounded: false, answer: 'No.', citations: [] });
    const user = userEvent.setup();
    render(<AIResume />);

    await user.type(screen.getByPlaceholderText(/enter your access code/i), 'conf-2026{Enter}');
    await user.type(
      screen.getByPlaceholderText(/ask about Eddie's work/i),
      'How does he work?{Enter}',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/air/ask',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-air-access': 'conf-2026' }),
      }),
    );
  });

  it('shows the sources a grounded answer drew on', async () => {
    window.localStorage.setItem('air-access-code', 'conf-2026');
    mockAnswer({
      grounded: true,
      answer: 'He built a smoke test that ran against the deployed site.',
      citations: ['platform-migration'],
      sources: [{ id: 'platform-migration', title: 'Migrated a build pipeline' }],
    });

    const user = userEvent.setup();
    render(<AIResume />);
    await user.type(
      screen.getByPlaceholderText(/ask about Eddie's work/i),
      'How does he deploy?{Enter}'
    );

    expect(await screen.findByText(/built a smoke test/i)).toBeInTheDocument();
    expect(screen.getByText('Drawn from')).toBeInTheDocument();
    expect(screen.getByText('Migrated a build pipeline')).toBeInTheDocument();
  });

  it('marks an ungrounded answer as a gap rather than an assessment', async () => {
    window.localStorage.setItem('air-access-code', 'conf-2026');
    mockAnswer({ grounded: false, answer: 'That is not something I can speak to.', citations: [] });

    const user = userEvent.setup();
    render(<AIResume />);
    await user.type(
      screen.getByPlaceholderText(/ask about Eddie's work/i),
      'Favourite pizza?{Enter}'
    );

    expect(await screen.findByText(/not something I can speak to/i)).toBeInTheDocument();
    expect(screen.getByText(/treat it as a gap/i)).toBeInTheDocument();
    expect(screen.queryByText('Drawn from')).not.toBeInTheDocument();
  });

  /**
   * The endpoint threw before it could write a body, and this component read
   * `response.json()` before checking `response.ok` — so the parse threw, the
   * `catch` ran, and a 500 was reported to the visitor as *their* network
   * failing. Telling someone to check their connection when the server is
   * broken sends them to fix the one thing they cannot.
   */
  it('blames the server, not the visitor, when an error carries no body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<AIResume />);
    await user.type(
      screen.getByPlaceholderText(/something you want to know about Eddie/i),
      'Anything?{Enter}'
    );

    expect(await screen.findByText(/problem on my end, not yours/i)).toBeInTheDocument();
    expect(screen.getByText(/error 500/i)).toBeInTheDocument();
    expect(screen.queryByText(/check your connection/i)).not.toBeInTheDocument();
  });

  it('does not render an unparseable 200 as though it were an answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected end of JSON input');
        },
      }),
    );

    const user = userEvent.setup();
    render(<AIResume />);
    await user.type(
      screen.getByPlaceholderText(/something you want to know about Eddie/i),
      'Anything?{Enter}'
    );

    expect(await screen.findByText(/could not read/i)).toBeInTheDocument();
    expect(screen.queryByText('Drawn from')).not.toBeInTheDocument();
  });

  it('surfaces the error when the gate rejects the code', async () => {
    window.localStorage.setItem('air-access-code', 'conf-2026');
    mockAnswer({ error: 'This resume is available by invitation.' }, false);

    const user = userEvent.setup();
    render(<AIResume />);
    await user.type(
      screen.getByPlaceholderText(/ask about Eddie's work/i),
      'Anything?{Enter}'
    );

    expect(await screen.findByText(/available by invitation/i)).toBeInTheDocument();
  });
});
