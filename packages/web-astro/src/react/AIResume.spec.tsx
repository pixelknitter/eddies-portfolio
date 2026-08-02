import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AIResume } from './AIResume';

/**
 * The behaviour worth testing here is not that an answer renders — it is that
 * a grounded answer and an ungrounded one are told apart on screen. An answer
 * the system could not support, rendered identically to one it could, is the
 * failure the whole retrieval and verification chain exists to prevent, and a
 * UI that shows them the same way would undo it entirely.
 */

/**
 * `status` matters as well as `ok`: the component treats 401 specially,
 * forgetting the stored code, so a test that only sets `ok: false` cannot
 * reach that branch.
 */
function mockAnswer(
  body: Record<string, unknown>,
  ok = true,
  status = ok ? 200 : 500,
) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok, status, json: async () => body });
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

  /**
   * The design started from the complaint that a visitor was met by a password
   * box before being shown what it was for. Opening in code mode when nothing
   * is stored reproduces exactly that, so the field asks for a question first
   * whether or not a code exists.
   */
  it('opens asking for a question, not for a code', () => {
    window.localStorage.clear();
    render(<AIResume />);
    expect(screen.getByPlaceholderText(/ask about Eddie's work/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/enter your access code/i)).not.toBeInTheDocument();
    // The access machinery belongs with the code prompt, which has not happened.
    expect(screen.queryByRole('button', { name: /ask Eddie for access/i })).not.toBeInTheDocument();
  });

  it('keeps the access machinery out of the way when a code is stored', () => {
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

  /**
   * The whole point of holding the question: it survives the detour through
   * the gate. Asking the visitor to retype it after unlocking would make the
   * gate the thing they remember.
   */
  it('holds the question, asks for a code, then sends it unprompted', async () => {
    window.localStorage.clear();
    const fetchMock = mockAnswer({ grounded: false, answer: 'No.', citations: [] });
    const user = userEvent.setup();
    render(<AIResume />);

    await user.type(
      screen.getByPlaceholderText(/ask about Eddie's work/i),
      'How does he work?{Enter}',
    );

    // Nothing sent yet — the field has become the code field, and it names the
    // question it is holding so the detour is legible.
    expect(fetchMock).not.toHaveBeenCalled();
    const codeField = screen.getByPlaceholderText(/enter your access code/i);
    expect(codeField).toHaveFocus();
    expect(screen.getByText(/How does he work\?/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /ask Eddie for access/i }),
    ).toBeInTheDocument();

    await user.type(codeField, 'conf-2026{Enter}');

    expect(window.localStorage.getItem('air-access-code')).toBe('conf-2026');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/air/ask',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-air-access': 'conf-2026' }),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).question).toBe(
      'How does he work?',
    );
  });

  it('returns to asking for questions once the code has been used', async () => {
    window.localStorage.clear();
    mockAnswer({ grounded: false, answer: 'No.', citations: [] });
    const user = userEvent.setup();
    render(<AIResume />);

    await user.type(
      screen.getByPlaceholderText(/ask about Eddie's work/i),
      'How does he work?{Enter}',
    );
    await user.type(
      screen.getByPlaceholderText(/enter your access code/i),
      'conf-2026{Enter}',
    );

    expect(
      await screen.findByPlaceholderText(/ask about Eddie's work/i),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/enter your access code/i)).not.toBeInTheDocument();
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

    window.localStorage.setItem('air-access-code', 'conf-2026');
    const user = userEvent.setup();
    render(<AIResume />);
    await user.type(
      screen.getByPlaceholderText(/ask about Eddie's work/i),
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

    window.localStorage.setItem('air-access-code', 'conf-2026');
    const user = userEvent.setup();
    render(<AIResume />);
    await user.type(
      screen.getByPlaceholderText(/ask about Eddie's work/i),
      'Anything?{Enter}'
    );

    expect(await screen.findByText(/could not read/i)).toBeInTheDocument();
    expect(screen.queryByText('Drawn from')).not.toBeInTheDocument();
  });

  /**
   * A failed question is still a wanted question. Clearing the field on error
   * makes the visitor retype it just to discover whether the failure was
   * theirs or ours.
   */
  it('keeps the question in the field when the ask fails', async () => {
    window.localStorage.setItem('air-access-code', 'conf-2026');
    mockAnswer({ error: 'Something went wrong.' }, false);

    const user = userEvent.setup();
    render(<AIResume />);

    const field = screen.getByPlaceholderText(/ask about Eddie's work/i);
    await user.type(field, 'How does he work?{Enter}');

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    expect(field).toHaveValue('How does he work?');
  });

  it('clears the field once an answer actually arrives', async () => {
    window.localStorage.setItem('air-access-code', 'conf-2026');
    mockAnswer({ grounded: false, answer: 'That is a gap.', citations: [] });

    const user = userEvent.setup();
    render(<AIResume />);

    const field = screen.getByPlaceholderText(/ask about Eddie's work/i);
    await user.type(field, 'How does he work?{Enter}');

    expect(await screen.findByText(/that is a gap/i)).toBeInTheDocument();
    expect(field).toHaveValue('');
  });

  /**
   * A stored code that the server rejects is worse than no code: the access UI
   * only appears when nothing is stored, so the visitor is left in question
   * mode with no route back to the one field that could fix it.
   */
  it('forgets a stored code the server rejects, and offers the field back', async () => {
    window.localStorage.setItem('air-access-code', 'stale-code');
    mockAnswer({ error: 'This resume is available by invitation.' }, false, 401);

    const user = userEvent.setup();
    render(<AIResume />);

    await user.type(
      screen.getByPlaceholderText(/ask about Eddie's work/i),
      'Anything?{Enter}',
    );

    expect(await screen.findByText(/available by invitation/i)).toBeInTheDocument();
    expect(window.localStorage.getItem('air-access-code')).toBeNull();
    // Back to asking for questions, not for a code: the gate appears only when
    // a question is actually waiting on one, and the next attempt will raise it.
    expect(screen.getByPlaceholderText(/ask about Eddie's work/i)).toBeInTheDocument();
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

  it('shows the answer in the same container the suggestions occupied', async () => {
    window.localStorage.setItem('air-access-code', 'conf-2026');
    mockAnswer({
      grounded: true,
      answer: 'He built a smoke test.',
      citations: ['platform-migration'],
      sources: [{ id: 'platform-migration', title: 'Migrated a build pipeline' }],
    });

    const user = userEvent.setup();
    render(<AIResume />);

    const region = screen.getByTestId('air-body');
    expect(within(region).getByRole('button', { name: /system nobody wants to own/i })).toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText(/ask about Eddie's work/i),
      'How does he deploy?{Enter}',
    );

    expect(await within(region).findByText(/built a smoke test/i)).toBeInTheDocument();
    // The suggestions gave way rather than stacking above the answer.
    expect(within(region).queryByRole('button', { name: /system nobody wants to own/i })).not.toBeInTheDocument();
  });

  /**
   * Asking without a code is a guaranteed 401, so the suggestions are held
   * shut until one is stored. Both directions are asserted: a disabled-only
   * test would still pass if the buttons were never enabled at all.
   */
  /**
   * A suggestion takes the same route a typed question does: it is held, the
   * code is asked for, and it is sent. A disabled button would have explained
   * nothing about why it would not respond.
   */
  it('holds a suggestion behind the gate rather than refusing it', async () => {
    window.localStorage.clear();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ grounded: false, answer: 'No.', citations: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<AIResume />);

    await user.click(
      within(screen.getByTestId('air-body')).getByRole('button', {
        name: /system nobody wants to own/i,
      }),
    );

    // Not sent — it would be a guaranteed 401 — and the field now asks for a
    // code while naming the question it is holding.
    expect(fetchMock).not.toHaveBeenCalled();
    const codeField = screen.getByPlaceholderText(/enter your access code/i);
    expect(codeField).toHaveFocus();
    expect(
      screen.getByText(/system nobody wants to own/i, { selector: 'p' }),
    ).toBeInTheDocument();

    await user.type(codeField, 'conf-2026{Enter}');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).question).toMatch(
      /system nobody wants to own/i,
    );
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

  it('shows the answer in the same container the suggestions occupied', async () => {
    window.localStorage.setItem('air-access-code', 'conf-2026');
    mockAnswer({
      grounded: true,
      answer: 'He built a smoke test.',
      citations: ['platform-migration'],
      sources: [{ id: 'platform-migration', title: 'Migrated a build pipeline' }],
    });

    const user = userEvent.setup();
    render(<AIResume />);

    const region = screen.getByTestId('air-body');
    expect(within(region).getByRole('button', { name: /system nobody wants to own/i })).toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText(/ask about Eddie's work/i),
      'How does he deploy?{Enter}',
    );

    expect(await within(region).findByText(/built a smoke test/i)).toBeInTheDocument();
    // The suggestions gave way rather than stacking above the answer.
    expect(within(region).queryByRole('button', { name: /system nobody wants to own/i })).not.toBeInTheDocument();
  });


  /**
   * Replaces an assertion that the button is *enabled*, which stopped meaning
   * anything once the codeless case became a redirect rather than a disable:
   * the button is now always enabled, so that test passed whether or not the
   * gate existed. This asserts what the gate actually does — with a code, the
   * question is sent.
   */
  it('sends the question straight through once a code is stored', async () => {
    window.localStorage.setItem('air-access-code', 'conf-2026');
    const fetchMock = mockAnswer({ grounded: false, answer: 'No.', citations: [] });

    const user = userEvent.setup();
    render(<AIResume />);

    await user.click(
      within(screen.getByTestId('air-body')).getByRole('button', {
        name: /system nobody wants to own/i,
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/air/ask',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-air-access': 'conf-2026' }),
      }),
    );
    expect(screen.queryByText(/needs an access code first/i)).not.toBeInTheDocument();
  });

  it('keeps the suggestions reachable once a code is stored', () => {
    window.localStorage.setItem('air-access-code', 'conf-2026');
    render(<AIResume />);

    const region = screen.getByTestId('air-body');
    expect(
      within(region).getByRole('button', { name: /system nobody wants to own/i }),
    ).toBeEnabled();
  });

  it('returns the container to the suggestions when asked for something else', async () => {
    window.localStorage.setItem('air-access-code', 'conf-2026');
    mockAnswer({
      grounded: true,
      answer: 'He built a smoke test.',
      citations: ['platform-migration'],
      sources: [{ id: 'platform-migration', title: 'Migrated a build pipeline' }],
    });

    const user = userEvent.setup();
    render(<AIResume />);

    const region = screen.getByTestId('air-body');
    await user.type(
      screen.getByPlaceholderText(/ask about Eddie's work/i),
      'How does he deploy?{Enter}',
    );
    expect(await within(region).findByText(/built a smoke test/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /ask something else/i }));

    expect(
      within(region).getByRole('button', { name: /system nobody wants to own/i }),
    ).toBeInTheDocument();
    // And the answer went with it, rather than being left above the suggestions.
    expect(within(region).queryByText(/built a smoke test/i)).not.toBeInTheDocument();
  });
});
