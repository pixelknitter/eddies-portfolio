/**
 * HTML escaping, shared by every surface that builds markup from a string.
 *
 * This started life inside `air/email.mjs`, which was the only place composing
 * HTML by hand. The resume needs it too — for the `**bold**` markers in bullet
 * text — and a second copy of an escape function is the kind of duplicate that
 * quietly diverges: one gets a fix for a missed character and the other does
 * not. So it lives here, and `air/email.mjs` re-exports it for its callers.
 */

/**
 * Escape text for interpolation into HTML.
 *
 * Both quote forms are escaped, not just `<` and `>`, so the result is safe in
 * an attribute value as well as in element content.
 *
 * @param {string} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
