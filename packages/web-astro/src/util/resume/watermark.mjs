/**
 * Per-requester PDF watermarking, on a 10ms CPU budget.
 *
 * Every served PDF carries a footer line naming who asked for it. That does not
 * stop anyone screenshotting or forwarding the file — nothing can, on the web or
 * off it — but it makes a circulated copy *attributable*, which changes behaviour
 * in a way a "do not distribute" notice does not.
 *
 * ## Why this is a byte patch and not a PDF edit
 *
 * This site runs on Workers Free: ~10ms CPU per request. Loading a few-hundred-KB
 * PDF into pdf-lib and re-saving it costs tens to hundreds of milliseconds, so
 * editing the document per request is not available at any price.
 *
 * So the *slot* is prepared at generation time and only *filled* per request.
 * `scripts/resume-pdf.mjs` draws a fixed-length run of `#` on every page inside
 * its own **uncompressed** content stream, records the byte offset of each run,
 * and ships those offsets alongside the PDF. Serving is then: copy the buffer,
 * overwrite those offsets with the same number of bytes. No length changes, so no
 * `/Length` fixup, no xref rewrite, no reparse. Measured at 64µs for four pages.
 *
 * ## Two things that make it work, both easy to break
 *
 *   - **The overlay is its own content stream.** Text drawn via pdf-lib's
 *     `drawText` lands in a Flate-compressed stream as a hex string, where no
 *     literal placeholder exists to find. The generator appends a `PDFRawStream`
 *     with no `/Filter` instead.
 *   - **The font is standard-14 Helvetica, which is not subset.** A subset font
 *     carries only the glyphs actually drawn — here, `#` — so replacing it with an
 *     email address would reference glyphs the file does not contain. Every
 *     WinAnsi character is available in a standard-14 face.
 *
 * If either changes, the generator's offset scan finds nothing, and the download
 * endpoint serves an unwatermarked PDF rather than a corrupt one. Degrading is
 * deliberate: the gate is what protects the file, and the watermark is a
 * deterrent on top of it.
 */

/**
 * Exact byte length of the watermark run.
 *
 * The patch is only safe because the replacement is the same size as the
 * placeholder, so this is a contract between the generator and the endpoint, not
 * a tunable. Changing it requires regenerating the PDFs.
 */
export const WATERMARK_LENGTH = 78;

/** What the generator draws, and what the endpoint overwrites. */
export const WATERMARK_PLACEHOLDER = '#'.repeat(WATERMARK_LENGTH);

/**
 * Characters that would break the PDF literal string the run sits inside.
 *
 * The overlay is written as `(text) Tj`, so an unescaped parenthesis or backslash
 * ends or escapes the string early and corrupts the page. Replacing rather than
 * escaping keeps the byte count fixed, which is the whole basis of the patch.
 */
const UNSAFE = /[()\\]/g;

/**
 * Compose the watermark line for one requester.
 *
 * ASCII only, and padded to exactly `WATERMARK_LENGTH`. A middle dot would be
 * representable in WinAnsi, but keeping the patched run to plain ASCII removes an
 * encoding question from the one code path that must never emit a broken PDF.
 *
 * @param {{email?: string, date?: string}} input
 * @returns {string} Exactly `WATERMARK_LENGTH` characters.
 */
export function composeWatermark({ email = '', date = '' } = {}) {
  const safeDate = String(date)
    .replace(UNSAFE, '_')
    .replace(/[^\x20-\x7e]/g, '');
  const cleanEmail = String(email)
    .replace(UNSAFE, '_')
    // Strip anything outside printable ASCII rather than transliterating it: an
    // internationalised address still identifies the requester by its ASCII part,
    // and a mangled glyph in a PDF reads as a bug.
    .replace(/[^\x20-\x7e]/g, '')
    .trim();

  const suffix = ` - ${safeDate} - Confidential`;
  const prefix = 'Prepared for ';
  const room = WATERMARK_LENGTH - prefix.length - suffix.length;

  // Truncation is visible rather than silent — a line ending "…" tells a reader
  // the address is cut, where a hard slice looks like a different address.
  const shown =
    cleanEmail.length > room
      ? `${cleanEmail.slice(0, Math.max(0, room - 1))}~`
      : cleanEmail;

  return `${prefix}${shown}${suffix}`
    .slice(0, WATERMARK_LENGTH)
    .padEnd(WATERMARK_LENGTH, ' ');
}

/**
 * Write the watermark into a copy of the PDF bytes.
 *
 * Does not mutate `pdf`: the decoded document is cached per isolate and shared
 * across requests, so patching in place would leak one requester's address into
 * the next requester's download.
 *
 * @param {Uint8Array} pdf Generated PDF bytes.
 * @param {number[]} offsets Byte offset of each placeholder run.
 * @param {string} line Exactly `WATERMARK_LENGTH` characters.
 * @returns {Uint8Array} A patched copy.
 */
export function applyWatermark(pdf, offsets, line) {
  if (line.length !== WATERMARK_LENGTH) {
    throw new Error(
      `watermark must be exactly ${WATERMARK_LENGTH} chars to preserve byte length, got ${line.length}`,
    );
  }

  const out = new Uint8Array(pdf);
  for (const offset of offsets ?? []) {
    // Out-of-range offsets would silently corrupt the document; a stale generated
    // module is the realistic way that happens.
    if (offset < 0 || offset + WATERMARK_LENGTH > out.length) {
      throw new Error(
        `watermark offset ${offset} is outside the ${out.length}-byte document`,
      );
    }
    for (let i = 0; i < WATERMARK_LENGTH; i++) {
      out[offset + i] = line.charCodeAt(i) & 0x7f;
    }
  }
  return out;
}
