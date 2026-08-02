# A.I.R. as a feature of the CV — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make A.I.R. legible as a feature of the résumé — a quick-ask control at the top of `/cv/` that lifts into a modal — and move every résumé control next to the thing it acts on.

**Architecture:** The quick-ask control is a real `<a href="/cv/air/">` rendered by Astro, which a small React island upgrades into a modal trigger. `/cv/air/` is retained and renders the same island, so there is one implementation and the no-JS path is the link. `ResumeVisual.astro` is never touched — it is fingerprinted, and `pdfs.spec.ts` is the tripwire proving it.

**Tech Stack:** Astro 7, React 19, Tailwind 4 (CSS-first `@theme`), Vitest + Testing Library, Cloudflare Workers.

## Global Constraints

- **`ResumeVisual.astro` and every file in `FINGERPRINTED_FILES` are off limits.** `pdfs.spec.ts` must stay green; if it goes red, stop rather than regenerate.
- **`--color-tag`/`--color-link` are paired tokens.** Never use bare `text-link` or `bg-tag` on a surface that appears in light mode; use `text-link-on-light dark:text-link` and `.badge`.
- **The quick-ask row renders only when A.I.R. is on** (`sections.air`). With it off, the top zone is the two download buttons and nothing else.
- **Expand/Collapse must never reach paper** — both carry `resume-no-print`.
- **Motion respects `prefers-reduced-motion`** via `motion-safe:` variants only.
- **The access code is per-device convenience, not a credential store.** It is a shared code already sent on every ask as `x-air-access`; `localStorage` changes how often it is retyped, nothing about exposure.
- Existing `Modal.tsx` already provides focus trap, Escape, focus restore, `role="dialog"`, `aria-modal`, `aria-labelledby`, and scroll lock. Do not reimplement these.

---

### Task 1: Give the dialog a lift, and a non-scrolling shell

**Files:**
- Modify: `packages/web-astro/src/styles/motion.css`
- Modify: `packages/web-astro/src/react/Modal.tsx:100-111`

**Interfaces:**
- Consumes: nothing.
- Produces: `Modal` accepts a new optional prop `bodyScrolls?: boolean` (default `true`). When `false`, the panel itself does not scroll — children own their scrolling. Existing call sites omit it and are unaffected.

- [ ] **Step 1: Add the lift keyframe**

In `motion.css`, beneath the existing `fade-in`:

```css
/*
 * Dialog entrance. The panel rises a short distance as it fades, so it reads as
 * coming forward from the page rather than appearing on top of it. 12px is
 * deliberately small — enough to imply origin, not far enough to feel like a
 * slide-in from off-screen.
 */
@keyframes lift-in {
  from {
    opacity: 0;
    translate: 0 12px;
  }
  to {
    opacity: 1;
    translate: 0 0;
  }
}
```

- [ ] **Step 2: Use it, and make the shell optionally non-scrolling**

In `Modal.tsx`, add `bodyScrolls` to `Props`:

```tsx
interface Props {
  open: boolean;
  onClose: () => void;
  /** Id of the heading that names the dialog, for `aria-labelledby`. */
  titleId: string;
  /**
   * Whether the panel itself scrolls. Default `true`, which suits a form.
   *
   * The ask dialog sets `false`: its input must stay put while only the region
   * beneath it scrolls, so that someone reading a long answer can ask the next
   * question without scrolling back up to find the field. A panel that scrolls
   * as a whole cannot offer that.
   */
  bodyScrolls?: boolean;
  children: React.ReactNode;
}
```

Destructure with a default, and swap the panel `className`:

```tsx
export function Modal({ open, onClose, titleId, bodyScrolls = true, children }: Props) {
```

```tsx
        className={`surface relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl p-4 motion-safe:animate-[lift-in_180ms_ease-out] sm:max-w-xl sm:rounded-2xl sm:p-6 ${
          bodyScrolls ? 'overflow-y-auto' : 'overflow-hidden'
        }`}
```

Also change the backdrop's animation to `motion-safe:animate-[fade-in_150ms_ease-out]` (unchanged — the backdrop fades, only the panel lifts).

- [ ] **Step 3: Verify the existing dialog still works**

Run: `cd packages/web-astro && npx vitest run src/react/AIResume.spec.tsx`
Expected: PASS — the access-request dialog uses the default `bodyScrolls`, so nothing about it changes.

- [ ] **Step 4: Commit**

```bash
git add packages/web-astro/src/styles/motion.css packages/web-astro/src/react/Modal.tsx
git commit -m "feat(modal): lift the panel in, and let children own scrolling"
```

---

### Task 2: Persist the access code

**Files:**
- Create: `packages/web-astro/src/util/air/access-code.mjs`
- Create: `packages/web-astro/src/util/air/access-code.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `readStoredCode(): string` — the stored code, or `''`.
  - `storeCode(code: string): void` — persists, or removes the key when given `''`.
  - `STORAGE_KEY: string` — exported for tests.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { readStoredCode, storeCode, STORAGE_KEY } from './access-code.mjs';

describe('access code storage', () => {
  beforeEach(() => window.localStorage.clear());

  it('returns an empty string when nothing is stored', () => {
    expect(readStoredCode()).toBe('');
  });

  it('round-trips a code', () => {
    storeCode('conf-2026');
    expect(readStoredCode()).toBe('conf-2026');
  });

  it('trims surrounding whitespace, which pasting a code from a card adds', () => {
    storeCode('  conf-2026  ');
    expect(readStoredCode()).toBe('conf-2026');
  });

  it('removes the key rather than storing an empty value', () => {
    storeCode('conf-2026');
    storeCode('');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(readStoredCode()).toBe('');
  });

  it('survives storage being unavailable', () => {
    const original = window.localStorage.getItem;
    // Safari in private mode throws on access rather than returning null.
    Object.defineProperty(window.localStorage, 'getItem', {
      configurable: true,
      value: () => { throw new DOMException('denied'); },
    });
    expect(readStoredCode()).toBe('');
    Object.defineProperty(window.localStorage, 'getItem', {
      configurable: true,
      value: original,
    });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd packages/web-astro && npx vitest run src/util/air/access-code.spec.ts`
Expected: FAIL — `Failed to resolve import "./access-code.mjs"`.

- [ ] **Step 3: Write the implementation**

```js
/**
 * Remembers the A.I.R. access code on this device.
 *
 * ## This is convenience, not a credential store
 *
 * The code is shared, not per-person, and it is already sent from the browser
 * on every ask as `x-air-access` — so any script on the origin can read it
 * either way. Persisting it changes how often a returning visitor retypes a
 * conference code, and nothing about what is exposed. A code that must not be
 * readable here is a code that must not be in the client at all, which is why
 * the real gate lives in `api/air/ask.ts`.
 *
 * Every access is wrapped: Safari in private mode throws on `localStorage`
 * rather than returning null, and a visitor with storage disabled should get a
 * site that asks for the code each time, not one that fails to render.
 */

export const STORAGE_KEY = 'air-access-code';

/** @returns {string} The stored code, or `''` if there is none. */
export function readStoredCode() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * @param {string} code Persisted after trimming. An empty value removes the
 *   key, so "forget my code" leaves nothing behind rather than an empty string
 *   that later reads as "stored".
 */
export function storeCode(code) {
  const trimmed = code.trim();
  try {
    if (trimmed) window.localStorage.setItem(STORAGE_KEY, trimmed);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable. The code stays in memory for this page view.
  }
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd packages/web-astro && npx vitest run src/util/air/access-code.spec.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/web-astro/src/util/air/access-code.mjs packages/web-astro/src/util/air/access-code.spec.ts
git commit -m "feat(air): remember the access code per device"
```

---

### Task 3: One input, two modes

**Files:**
- Modify: `packages/web-astro/src/react/AIResume.tsx`
- Modify: `packages/web-astro/src/react/AIResume.spec.tsx`

**Interfaces:**
- Consumes: `readStoredCode`, `storeCode` from Task 2.
- Produces: `AIResume` accepts `variant?: 'page' | 'dialog'` (default `'page'`). The `'dialog'` variant renders without the `<h1>` and page lede. Task 5 consumes this.

- [ ] **Step 1: Write the failing tests**

Add to `AIResume.spec.tsx`:

```tsx
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
```

Add `beforeEach(() => window.localStorage.clear());` inside the top-level `describe` so stored state never leaks between tests.

Update the existing test `sends the access code with the question` — it types into a separate "Access code" field that no longer exists. Replace its body with:

```tsx
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
```

Every other existing test types into `/something you want to know about Eddie/i`, which this task removes. Change those queries to `/ask about Eddie's work/i` and give each a stored code by adding this to the top of each such test:

```tsx
    window.localStorage.setItem('air-access-code', 'conf-2026');
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/web-astro && npx vitest run src/react/AIResume.spec.tsx`
Expected: FAIL — no element with placeholder `Enter your access code`.

- [ ] **Step 3: Replace the two inputs with one**

In `AIResume.tsx`, replace the `accessCode` state initialiser and the access-code + question block.

State:

```tsx
  const [accessCode, setAccessCode] = React.useState('');
  const [draft, setDraft] = React.useState('');
```

Hydrate from storage in an effect rather than in the initialiser — the island server-renders, and reading `localStorage` during render makes the first client render disagree with the server's:

```tsx
  React.useEffect(() => {
    setAccessCode(readStoredCode());
  }, []);

  const hasCode = accessCode !== '';
```

Replace the markup from the `Access code` label through the `Press Enter to ask.` paragraph with:

```tsx
        <label htmlFor="air-input" className="mb-2 block font-body font-semibold">
          {hasCode ? 'Ask a question' : 'Access code'}
        </label>
        {/*
          One field, two modes, keyed on whether a code is stored. The
          placeholder is what signals the shift — a second field or a mode
          toggle would both be more machinery than the state warrants, and a
          visitor who has a code should never see the access UI at all.
        */}
        <input
          id="air-input"
          ref={inputRef}
          type={hasCode ? 'text' : 'password'}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="w-full rounded-lg border border-hairline bg-light p-3 text-dark focus:outline-2 focus:outline-offset-2 focus:outline-underline dark:border-hairline-dark dark:bg-dark dark:text-light dark:focus:outline-link"
          placeholder={hasCode ? "Ask about Eddie's work…" : 'Enter your access code'}
          autoComplete="off"
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            if (hasCode) {
              ask(draft);
            } else {
              const code = draft.trim();
              if (!code) return;
              storeCode(code);
              setAccessCode(code);
            }
            setDraft('');
          }}
        />
        <p className="mt-2 font-body text-sm opacity-70">
          {hasCode ? 'Press Enter to ask.' : 'Press Enter to save it on this device.'}
        </p>

        {/*
          Hidden once a code is stored, so a returning visitor never sees the
          access machinery. It sits here rather than on /cv/ because this is
          where a code is actually needed, and "hides when one is stored" only
          reads correctly beside the field whose mode it describes.
        */}
        {!hasCode && (
          <button
            type="button"
            onClick={() => setRequesting(true)}
            className="mt-2 font-body text-sm underline decoration-underline underline-offset-4 dark:decoration-link"
          >
            Don&rsquo;t have a code? Ask Eddie for access
          </button>
        )}
```

Add the import at the top:

```tsx
import { readStoredCode, storeCode } from '../util/air/access-code.mjs';
```

In `ask()`, replace the suggestion click handler's use of `inputRef.current.value` — the input is now controlled. The suggestion buttons become:

```tsx
                  onClick={() => ask(item.question)}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd packages/web-astro && npx vitest run src/react/AIResume.spec.tsx`
Expected: PASS — all cases including the four new ones.

- [ ] **Step 5: Commit**

```bash
git add packages/web-astro/src/react/AIResume.tsx packages/web-astro/src/react/AIResume.spec.tsx
git commit -m "feat(air): one input, two modes, keyed on a stored code"
```

---

### Task 4: Two regions — floor, ceiling, and internal scroll

**Files:**
- Modify: `packages/web-astro/src/react/AIResume.tsx`
- Modify: `packages/web-astro/src/react/AIResume.spec.tsx`

**Interfaces:**
- Consumes: Task 3's single input.
- Produces: the suggestions and the answer share one container, so Task 5's dialog has a stable-height body.

- [ ] **Step 1: Write the failing test**

```tsx
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
```

Add `within` to the Testing Library import:

```tsx
import { render, screen, within } from '@testing-library/react';
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/web-astro && npx vitest run src/react/AIResume.spec.tsx -t "same container"`
Expected: FAIL — `Unable to find an element by: [data-testid="air-body"]`.

- [ ] **Step 3: Merge the two regions into one**

Replace the suggestions block *and* the trailing `aria-live` answer block with a single container:

```tsx
        {/*
          One container, two contents. Picking a suggestion or asking a question
          swaps what is inside it rather than revealing a second panel below.

          `min-h-80` is the floor: it fits the suggestions, so the swap does not
          resize the dialog under the reader's cursor. `max-h-[50dvh]` with
          `overflow-y-auto` is the ceiling: a long answer with sources grows the
          box until it reaches the available screen height and then scrolls
          inside itself. Only this region scrolls — the input above stays put, so
          a follow-up question never requires scrolling back to find the field.
        */}
        <div
          data-testid="air-body"
          aria-live="polite"
          aria-busy={pending}
          className="mt-6 min-h-80 max-h-[50dvh] overflow-y-auto"
        >
          {pending && (
            <p className="font-body opacity-70">Reading through Eddie&rsquo;s work&hellip;</p>
          )}

          {!pending && error && <p className="font-body">{error}</p>}

          {!pending && !error && !answer && (
            <>
              <p className="mb-2 font-body text-sm font-semibold">Not sure where to start?</p>
              <ul className="flex list-none flex-col gap-2 pl-0">
                {SUGGESTED.map((item) => (
                  <li key={item.question}>
                    <button
                      type="button"
                      disabled={pending || !hasCode}
                      onClick={() => ask(item.question)}
                      className="w-full rounded-lg border border-hairline p-3 text-left transition-colors hover:border-underline disabled:opacity-50 dark:border-hairline-dark dark:hover:border-link"
                    >
                      <span className="badge">{item.audience}</span>
                      <span className="mt-2 block font-body">{item.question}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {!pending && answer && (
            <div>
              <h2 className="mb-3 font-body text-xl no-underline decoration-0">{question}</h2>

              {answer.answer
                .split('\n')
                .filter(Boolean)
                .map((paragraph, index) => (
                  <p key={index} className="mb-3 font-body leading-relaxed">
                    {paragraph}
                  </p>
                ))}

              {answer.grounded && answer.sources && answer.sources.length > 0 && (
                <div className="mt-4 border-t border-hairline pt-4 dark:border-hairline-dark">
                  <p className="mb-2 font-body text-sm font-semibold">Drawn from</p>
                  <ul className="flex list-none flex-wrap gap-2 pl-0">
                    {answer.sources.map((source) => (
                      <li key={source.id}>
                        <span className="badge">{source.title}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!answer.grounded && (
                <p className="mt-4 border-t border-hairline pt-4 font-body text-sm opacity-70 dark:border-hairline-dark">
                  No sources &mdash; this answer isn&rsquo;t grounded in Eddie&rsquo;s written
                  work, so treat it as a gap rather than an assessment.
                </p>
              )}

              <button
                type="button"
                onClick={() => {
                  setAnswer(null);
                  setError(null);
                }}
                className="mt-4 font-body text-sm underline decoration-underline underline-offset-4 dark:decoration-link"
              >
                Ask something else
              </button>
            </div>
          )}
        </div>
```

Delete the old standalone `aria-live` block at the end of the component — this one replaces it.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd packages/web-astro && npx vitest run src/react/AIResume.spec.tsx`
Expected: PASS — all cases.

- [ ] **Step 5: Commit**

```bash
git add packages/web-astro/src/react/AIResume.tsx packages/web-astro/src/react/AIResume.spec.tsx
git commit -m "feat(air): give suggestions and answers one container with a floor and ceiling"
```

---

### Task 5: The dialog variant, and the quick-ask trigger

**Files:**
- Modify: `packages/web-astro/src/react/AIResume.tsx`
- Create: `packages/web-astro/src/react/AskAir.tsx`
- Create: `packages/web-astro/src/react/AskAir.spec.tsx`

**Interfaces:**
- Consumes: `AIResume` with `variant`, `Modal` with `bodyScrolls` from Task 1.
- Produces: `AskAir` — default export, props `{ href: string }`. Task 6 renders it.

- [ ] **Step 1: Add the variant to AIResume**

Give `AIResume` a props object:

```tsx
interface AIResumeProps {
  /**
   * `'page'` renders the standalone /cv/air/ surface with its own heading.
   * `'dialog'` drops the heading and lede, because the dialog is already
   * labelled by its own title and repeating it wastes the height the answer
   * container needs.
   */
  variant?: 'page' | 'dialog';
}

export function AIResume({ variant = 'page' }: AIResumeProps) {
```

Wrap the `<h1>` and its lede:

```tsx
      {variant === 'page' && (
        <>
          <h1>Ask A.I.R. about Eddie&rsquo;s work</h1>
          <p className="font-body text-lg">
            It answers from Eddie&rsquo;s written work &mdash; the résumé, the project
            write-ups, the stories behind them &mdash; and tells you when it can&rsquo;t.
          </p>
        </>
      )}
```

And make the panel chrome conditional, so the dialog does not draw a card inside a card:

```tsx
      <div className={variant === 'page' ? 'surface mt-6 p-4 sm:p-6' : ''}>
```

- [ ] **Step 2: Write the failing test for the trigger**

`AskAir.spec.tsx`:

```tsx
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

  it('opens the dialog on focus rather than waiting for a submit', async () => {
    const user = userEvent.setup();
    render(<AskAir href="/cv/air/" />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.tab();
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

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<AskAir href="/cv/air/" />);

    await user.click(screen.getByRole('link', { name: /ask A\.I\.R\./i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd packages/web-astro && npx vitest run src/react/AskAir.spec.tsx`
Expected: FAIL — `Failed to resolve import "./AskAir"`.

- [ ] **Step 4: Write AskAir**

```tsx
import React from 'react';

import Modal from './Modal';
import { AIResume } from './AIResume';

/**
 * The résumé's front door to A.I.R.
 *
 * Styled as an input but it is **not a text field** — it is the modal trigger,
 * and focusing it opens the dialog. Stated because the alternative reading
 * (type here, press enter, then the modal opens) means a visitor's first
 * keystrokes land in a control that is about to be replaced, and the text has
 * to be carried across. One input that accepts text lives in the dialog; this
 * one only opens it.
 *
 * It is an `<a href>` rather than a `<button>` so that the feature works with
 * JavaScript off: the link goes to /cv/air/, which renders the same island as
 * a full page. The upgrade is `preventDefault` on activation.
 */

interface Props {
  /** The standalone page, followed when JavaScript is unavailable. */
  href: string;
}

export function AskAir({ href }: Props) {
  const [open, setOpen] = React.useState(false);

  const openDialog = React.useCallback((event?: React.SyntheticEvent) => {
    event?.preventDefault();
    setOpen(true);
  }, []);

  return (
    <>
      <a
        href={href}
        onClick={openDialog}
        // Focus opens it: someone who has clicked into the field is already
        // asking, and making them press Enter first to reach the real input
        // buys nothing.
        onFocus={openDialog}
        className="flex w-full items-center gap-2 rounded-lg border border-hairline bg-surface p-3 text-left font-body no-underline opacity-90 transition-colors hover:border-underline dark:border-hairline-dark dark:bg-surface-dark dark:hover:border-link"
      >
        <span aria-hidden="true">✦</span>
        <span>Ask A.I.R. about Eddie&rsquo;s work&hellip;</span>
      </a>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        titleId="air-dialog-title"
        // The input must not scroll away; only the answer region does.
        bodyScrolls={false}
      >
        <h2
          id="air-dialog-title"
          className="mb-3 font-body text-xl no-underline decoration-0"
        >
          Ask A.I.R.
        </h2>
        <AIResume variant="dialog" />
      </Modal>
    </>
  );
}

export default AskAir;
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `cd packages/web-astro && npx vitest run src/react/AskAir.spec.tsx src/react/AIResume.spec.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web-astro/src/react/AskAir.tsx packages/web-astro/src/react/AskAir.spec.tsx packages/web-astro/src/react/AIResume.tsx
git commit -m "feat(air): add the quick-ask trigger that lifts into a dialog"
```

---

### Task 6: Rebuild the `/cv/` control layout

**Files:**
- Modify: `packages/web-astro/src/pages/cv/index.astro`
- Delete: `packages/web-astro/src/components/resume/ResumeActions.astro`

**Not modified, and worth knowing why:**
- `packages/web-astro/src/pages/cv/air/index.astro` needs **no change**. It renders `<AIResume client:load />`, and Task 5 gives `variant` a default of `'page'` — so the standalone route keeps its heading and lede with no edit. Do not add `variant="page"` explicitly; the default is the point.
- The `<link rel="alternate" type="text/html" href={botsPath}>` already exists in this file's `<head>` (added when the résumé shipped). **Do not add a second one.** Dissolving `ResumeActions` makes this the only in-page pointer to `/cv/for-bots`, which is why `botsPath` must stay defined even though nothing else consumes it now.

**Interfaces:**
- Consumes: `AskAir` from Task 5.
- Produces: the final page layout. No later task depends on it.

- [ ] **Step 1: Move Expand all, and add the quick-ask row**

In `cv/index.astro`, replace the action-bar block (lines ~110-121) with:

```astro
  <div class="organic resume-action-bar resume-no-print">
    <ResumeDownload client:visible />
  </div>

  {
    /*
    A.I.R.'s front door, in the slot `Expand all` used to occupy. Rendered only
    when the feature is on: with it off, the top zone is the two download
    buttons and nothing else, rather than a control that leads to a 404.
  */
  }
  {
    airPath && (
      <div class="organic resume-no-print mx-auto mt-3 max-w-3xl">
        <AskAir client:visible href={airPath} />
      </div>
    )
  }
```

Replace the `ResumeVisual` block with one that puts the toggles either side of the sections:

```astro
  <div class="resume-no-print">
    <ResumeVisual {resume}>
      {
        /*
        `Expand all` now sits beside what it expands, rather than 628px above it
        and above the résumé card entirely — where it offered to expand
        something the visitor had not yet seen. A matching control at the foot
        serves someone who has read to the bottom and wants to fold it back up
        without scrolling to the top.

        Both are excluded from print: they toggle <details> elements that print
        open regardless, so on paper they are two dead buttons.
      */
      }
      <div slot="actions" class="resume-no-print">
        <button
          type="button"
          class="resume-cta resume-cta-secondary"
          data-resume-expand
          aria-expanded="false"
        >
          Expand all
        </button>
      </div>
    </ResumeVisual>

    <div class="resume-no-print mx-auto mt-4 max-w-3xl">
      <button
        type="button"
        class="resume-cta resume-cta-secondary"
        data-resume-expand
        aria-expanded="false"
      >
        Expand all
      </button>
    </div>
  </div>
```

Update the imports — drop `ResumeActions`, add `AskAir`:

```astro
import { AskAir } from '../../react/AskAir';
```

Remove the now-unused `botsPath` prop usage on `ResumeActions` but keep the `botsPath` constant: the `<link rel="alternate">` already in `<head>` still uses it, and that is now the only in-page pointer to `/cv/for-bots`.

`airPath` stays as it is — `sections.air ? '/cv/air/' : undefined` — and is what gates the quick-ask row above.

- [ ] **Step 2: Make the expand script drive both buttons**

Replace `initResumeExpand`'s single-button lookup with a list, so the pair stay in step:

```ts
  function initResumeExpand() {
    // Two controls now — one above the sections and one below — and they must
    // report the same state, so a click on either updates both labels.
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-resume-expand]'),
    );
    const scope = document.querySelector<HTMLElement>('[data-resume-sections]');
    if (buttons.length === 0 || !scope) return;

    const sections = Array.from(scope.querySelectorAll<HTMLDetailsElement>('details'));
    if (sections.length === 0) return;

    const sync = () => {
      const allOpen = sections.every((section) => section.open);
      for (const button of buttons) {
        button.textContent = allOpen ? 'Collapse all' : 'Expand all';
        button.setAttribute('aria-expanded', String(allOpen));
      }
    };

    for (const button of buttons) {
      button.addEventListener('click', () => {
        const allOpen = sections.every((section) => section.open);
        for (const section of sections) section.open = !allOpen;
        sync();
      });
    }

    for (const section of sections) section.addEventListener('toggle', sync);

    sync();
  }
```

- [ ] **Step 3: Delete the dissolved component**

```bash
git rm packages/web-astro/src/components/resume/ResumeActions.astro
```

- [ ] **Step 4: Verify the build and the fingerprint tripwire**

Run: `cd ../.. && CONTENT_SEAL_KEY="$(cat ~/.config/eddies-portfolio/content-seal.key)" NX_DAEMON=false yarn ci`
Expected: PASS — `check`, `lint`, `test`, `build` all green, and `pdfs.spec.ts`'s `matches the sources it was generated from` still passing, proving no fingerprinted file was touched.

- [ ] **Step 5: Commit**

```bash
git add packages/web-astro/src/pages/cv/index.astro packages/web-astro/src/pages/cv/air/index.astro
git commit -m "feat(cv): put each control beside the thing it acts on"
```

---

### Task 7: Verify against a real Worker

**Files:**
- None modified. This task is verification only, and produces the evidence for the PR body.

- [ ] **Step 1: Build with the feature on and serve it**

```bash
cd packages/web-astro
CONTENT_SEAL_KEY="$(cat ~/.config/eddies-portfolio/content-seal.key)" \
  PUBLIC_SHOW_AIR=true PUBLIC_SHOW_RESUME=true npx astro build
npx wrangler dev -c dist/server/wrangler.json --port 4319 --local --inspector-port 0
```

- [ ] **Step 2: Confirm the flag-off case**

```bash
CONTENT_SEAL_KEY="$(cat ~/.config/eddies-portfolio/content-seal.key)" \
  PUBLIC_SHOW_RESUME=true npx astro build   # note: no PUBLIC_SHOW_AIR
```

Serve it and confirm `/cv/` renders the two download buttons and **no** quick-ask row, and that `/cv/air/` returns 404.

- [ ] **Step 3: Confirm the layout claims**

On a 412×915 (Pixel 7) viewport, measure the y-offset of `Expand all` and of the first `<details>`. Expected: adjacent, against the 628px gap recorded in the spec.

- [ ] **Step 4: Confirm the answer container's floor and ceiling**

Open the dialog, measure the body region's height, pick a suggestion, and measure again after the answer renders. Expected: unchanged for a short answer. For a long one, expect the region to stop at the viewport bound and scroll internally while the input stays visible.

- [ ] **Step 5: Confirm `/cv/for-bots` is still discoverable**

```bash
curl -s http://127.0.0.1:4319/cv/ | grep 'rel="alternate"'
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4319/cv/for-bots
```

Expected: the `<link>` is present, and the route returns 200.

- [ ] **Step 6: Confirm the deploy is not intermittently truncated**

The lesson from the #71 preview: a single request proves nothing.

```bash
for i in $(seq 1 20); do
  curl -s -o /dev/null -w "%{size_download}\n" --max-time 10 "http://127.0.0.1:4319/cv/?x=$i"
done
```

Expected: 20 identical sizes.
