import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ResumeDownload } from './ResumeDownload';

/** What the request endpoint returns on success. */
const OK_BODY = {
  ok: true,
  downloads: [
    {
      format: 'human',
      label: 'Full resume (human readable)',
      filename: 'Eddie-Freeman-Resume.pdf',
      url: '/api/resume/download?format=human&token=abc',
    },
  ],
  expiresInSeconds: 900,
  notified: true,
  message:
    'Thanks — your download is starting. The links stay valid for 15 minutes.',
};

/** Hrefs the island tried to download, per test. */
let clicked: string[] = [];

function stubFetch(response: unknown, ok = true, status = 200) {
  const spy = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => response,
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => {
  clicked = [];
  // The island starts a download by clicking a synthesised anchor. jsdom has no
  // download behaviour, and an unstubbed click would try to navigate.
  // A body, because an empty arrow trips no-empty-function. Recording the calls is
  // also more useful than discarding them.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this.href);
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ResumeDownload', () => {
  it('offers both formats before asking for anything', () => {
    render(<ResumeDownload />);
    expect(
      screen.getByRole('button', { name: /human readable/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /bot readable/i }),
    ).toBeInTheDocument();
    // The gate should not be in anyone's way until they want the file.
    expect(screen.queryByLabelText(/your email/i)).not.toBeInTheDocument();
  });

  it('asks for an address and a reason once a format is chosen', async () => {
    const user = userEvent.setup();
    render(<ResumeDownload />);

    await user.click(screen.getByRole('button', { name: /human readable/i }));

    expect(screen.getByLabelText(/your email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/why you.*interested/i)).toBeInTheDocument();
  });

  it('sends the chosen format with the request', async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch(OK_BODY);
    render(<ResumeDownload />);

    await user.click(screen.getByRole('button', { name: /bot readable/i }));
    await user.type(screen.getByLabelText(/your email/i), 'jane@acme.com');
    await user.type(
      screen.getByLabelText(/why you.*interested/i),
      'Hiring for a staff platform role.',
    );
    await user.click(screen.getByRole('button', { name: /get the pdf/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/resume/request');
    expect(JSON.parse(init.body)).toMatchObject({
      email: 'jane@acme.com',
      format: 'bot',
    });
  });

  /**
   * The fallback that matters. The download is started by clicking a synthesised
   * anchor, which browsers block in some configurations — so the links are rendered
   * too. Without them a blocked click looks like a form that did nothing.
   */
  it('renders the links as well as triggering them', async () => {
    const user = userEvent.setup();
    stubFetch(OK_BODY);
    render(<ResumeDownload />);

    await user.click(screen.getByRole('button', { name: /human readable/i }));
    await user.type(screen.getByLabelText(/your email/i), 'jane@acme.com');
    await user.type(
      screen.getByLabelText(/why you.*interested/i),
      'Hiring for a role.',
    );
    await user.click(screen.getByRole('button', { name: /get the pdf/i }));

    const link = await screen.findByRole('link', { name: /human readable/i });
    expect(link).toHaveAttribute('href', OK_BODY.downloads[0].url);
    expect(link).toHaveAttribute('download', 'Eddie-Freeman-Resume.pdf');

    // And the programmatic trigger fired too — the visible link is the fallback,
    // not the mechanism.
    await waitFor(() =>
      expect(clicked.some((href) => href.includes('format=human'))).toBe(true),
    );
  });

  it('reports the server-side reason when a request is rejected', async () => {
    const user = userEvent.setup();
    stubFetch(
      { error: 'Tell me a little about why you are reaching out.' },
      false,
      400,
    );
    render(<ResumeDownload />);

    await user.click(screen.getByRole('button', { name: /human readable/i }));
    await user.type(screen.getByLabelText(/your email/i), 'jane@acme.com');
    await user.type(
      screen.getByLabelText(/why you.*interested/i),
      'because ok',
    );
    await user.click(screen.getByRole('button', { name: /get the pdf/i }));

    expect(
      await screen.findByText(/tell me a little about why/i),
    ).toBeInTheDocument();
  });

  it('says something useful when the network fails', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<ResumeDownload />);

    await user.click(screen.getByRole('button', { name: /human readable/i }));
    await user.type(screen.getByLabelText(/your email/i), 'jane@acme.com');
    await user.type(
      screen.getByLabelText(/why you.*interested/i),
      'because reasons',
    );
    await user.click(screen.getByRole('button', { name: /get the pdf/i }));

    expect(
      await screen.findByText(/could not reach the server/i),
    ).toBeInTheDocument();
  });

  it('can be dismissed without sending anything', async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch(OK_BODY);
    render(<ResumeDownload />);

    await user.click(screen.getByRole('button', { name: /human readable/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByLabelText(/your email/i)).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
