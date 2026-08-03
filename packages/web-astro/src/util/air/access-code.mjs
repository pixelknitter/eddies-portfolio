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
