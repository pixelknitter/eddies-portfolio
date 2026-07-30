import { describe, it, expect } from 'vitest';
import {
  composeWatermark,
  applyWatermark,
  WATERMARK_LENGTH,
  WATERMARK_PLACEHOLDER,
} from './watermark.mjs';

/**
 * The patch is only safe because the replacement is exactly as long as the
 * placeholder. Every assertion about length here is guarding a corrupt PDF, not
 * tidiness — a shorter line leaves stale bytes and a longer one overwrites the
 * `) Tj` that terminates the string.
 */
describe('composeWatermark', () => {
  it('is always exactly the placeholder length', () => {
    const inputs = [
      { email: 'a@b.co', date: '2026-07-29' },
      { email: '', date: '' },
      {
        email: `${'x'.repeat(240)}@very-long-domain.example`,
        date: '2026-07-29',
      },
      { email: 'ünïcødé@exämple.com', date: '2026-07-29' },
      { email: 'has(parens)and\\backslash@x.com', date: '2026-07-29' },
      {},
    ];
    for (const input of inputs) {
      expect(composeWatermark(input), JSON.stringify(input)).toHaveLength(
        WATERMARK_LENGTH,
      );
    }
  });

  it('names the requester and the date', () => {
    const line = composeWatermark({
      email: 'jane@acme.com',
      date: '2026-07-29',
    });
    expect(line).toContain('jane@acme.com');
    expect(line).toContain('2026-07-29');
    expect(line.trimEnd()).toMatch(/Confidential$/);
  });

  // The line is written into a PDF literal string, `(text) Tj`. An unescaped
  // parenthesis or backslash ends or escapes it early and corrupts the page.
  // They are replaced rather than escaped, because escaping changes the length.
  it('neutralises PDF string delimiters', () => {
    const line = composeWatermark({
      email: 'a(b)c\\d@x.com',
      date: '2026-07-29',
    });
    expect(line).not.toMatch(/[()\\]/);
    expect(line).toHaveLength(WATERMARK_LENGTH);
  });

  // Anything outside printable ASCII risks a glyph the standard-14 face cannot
  // draw, and a mangled character in a PDF reads as a bug rather than as data.
  it('emits printable ASCII only', () => {
    const line = composeWatermark({
      email: 'ünïcødé@exämple.com',
      date: '2026-07-29',
    });
    expect(line).toMatch(/^[\x20-\x7e]+$/);
  });

  it('marks a truncated address visibly rather than silently', () => {
    const line = composeWatermark({
      email: `${'x'.repeat(200)}@example.com`,
      date: '2026-07-29',
    });
    expect(line).toContain('~');
    expect(line).toHaveLength(WATERMARK_LENGTH);
  });
});

describe('applyWatermark', () => {
  /** A stand-in document with the placeholder at two known offsets. */
  function fixture() {
    const prefix = '%PDF-1.7\n(';
    const middle = ') Tj\n(';
    const suffix = ') Tj\n%%EOF';
    const text =
      prefix + WATERMARK_PLACEHOLDER + middle + WATERMARK_PLACEHOLDER + suffix;
    const bytes = Uint8Array.from(Buffer.from(text, 'latin1'));
    return {
      bytes,
      offsets: [
        prefix.length,
        prefix.length + WATERMARK_LENGTH + middle.length,
      ],
    };
  }

  const line = composeWatermark({ email: 'jane@acme.com', date: '2026-07-29' });

  it('preserves byte length', () => {
    const { bytes, offsets } = fixture();
    expect(applyWatermark(bytes, offsets, line)).toHaveLength(bytes.length);
  });

  it('writes the line at every offset', () => {
    const { bytes, offsets } = fixture();
    const out = Buffer.from(applyWatermark(bytes, offsets, line)).toString(
      'latin1',
    );
    expect(out.split('jane@acme.com')).toHaveLength(offsets.length + 1);
    expect(out).not.toContain('####');
  });

  // The decoded document is cached per isolate and shared between requests, so
  // patching in place would leak one requester's address into the next download.
  it('does not mutate its input', () => {
    const { bytes, offsets } = fixture();
    const before = Buffer.from(bytes).toString('latin1');
    applyWatermark(bytes, offsets, line);
    expect(Buffer.from(bytes).toString('latin1')).toBe(before);
  });

  it('leaves the document untouched when there are no offsets', () => {
    const { bytes } = fixture();
    expect(
      Buffer.from(applyWatermark(bytes, [], line)).toString('latin1'),
    ).toBe(Buffer.from(bytes).toString('latin1'));
  });

  it('refuses a line of the wrong length', () => {
    const { bytes, offsets } = fixture();
    expect(() => applyWatermark(bytes, offsets, 'too short')).toThrow(
      /exactly/,
    );
  });

  // A stale generated module is the realistic way an offset ends up past the end
  // of the document, and silently corrupting the PDF is the worst outcome.
  it('refuses an offset outside the document', () => {
    const { bytes } = fixture();
    expect(() => applyWatermark(bytes, [bytes.length - 2], line)).toThrow(
      /outside/,
    );
    expect(() => applyWatermark(bytes, [-1], line)).toThrow(/outside/);
  });
});
