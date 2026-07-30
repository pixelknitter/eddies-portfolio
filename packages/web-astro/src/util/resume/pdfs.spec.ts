import { describe, it, expect } from 'vitest';
import {
  RESUME_PDFS,
  RESUME_DATA_HASH,
  GENERATED_AT,
} from './pdfs.generated.mjs';
import { resumeFingerprint } from './fingerprint.mjs';
import { WATERMARK_LENGTH, WATERMARK_PLACEHOLDER } from './watermark.mjs';

/**
 * The PDFs are build artifacts committed into the repo, so every invariant that
 * makes them servable has to be checked somewhere other than by eye. This rides
 * `nx test`, which is already in `yarn ci` — no new CI wiring.
 */

const variants = Object.entries(RESUME_PDFS);
const generated = RESUME_DATA_HASH !== '';

describe('generated resume PDFs', () => {
  // A fresh clone has the stub committed, because the generator needs the app to
  // build in order to render the routes it prints. Skipping rather than failing
  // keeps a keyless checkout green; the endpoint returns 503 in that state.
  it.runIf(!generated)('is a stub before the generator has been run', () => {
    for (const [key, pdf] of variants) {
      expect(pdf.bytes, key).toBe(0);
      expect(pdf.base64, key).toBe('');
    }
  });

  it.runIf(generated)('matches the sources it was generated from', () => {
    // The failure this catches: editing the resume or the print layout and
    // forgetting to regenerate, leaving a download that disagrees with the site.
    expect(
      RESUME_DATA_HASH,
      'Resume data or print layout changed since the PDFs were generated. ' +
        'Run `yarn resume:pdf` and commit the result.',
    ).toBe(resumeFingerprint());
  });

  it.runIf(generated)('records a generation date', () => {
    expect(GENERATED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  describe.runIf(generated)('each variant', () => {
    // Standard base64, never base64url. base64url's `-` can form the `sk-` prefix
    // that scripts/check-bundle-secrets.mjs matches, which measured as a false
    // positive in 13 of 20 sampled encodings — a flaky red CI weeks later.
    it('is encoded with the standard base64 alphabet', () => {
      for (const [key, pdf] of variants) {
        expect(pdf.base64, key).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
        expect(pdf.base64, `${key} must not use base64url`).not.toMatch(/[-_]/);
      }
    });

    it('declares a length matching its payload', () => {
      for (const [key, pdf] of variants) {
        expect(Buffer.from(pdf.base64, 'base64'), key).toHaveLength(pdf.bytes);
      }
    });

    it('decodes to a well-formed PDF', () => {
      for (const [key, pdf] of variants) {
        const bytes = Buffer.from(pdf.base64, 'base64');
        expect(bytes.subarray(0, 5).toString('latin1'), key).toBe('%PDF-');
        // Trailing whitespace after %%EOF is legal, so search the tail.
        expect(bytes.subarray(-64).toString('latin1'), key).toContain('%%EOF');
      }
    });

    // The bundle ceiling is 3 MB compressed on Workers Free; base64 costs ~1%
    // once gzip runs, so these bound the whole feature well inside it.
    it('stays inside the size budget', () => {
      let total = 0;
      for (const [key, pdf] of variants) {
        expect(
          pdf.bytes,
          `${key} is too large for the Worker bundle`,
        ).toBeLessThanOrEqual(600_000);
        total += pdf.bytes;
      }
      expect(
        total,
        'combined PDFs are too large for the Worker bundle',
      ).toBeLessThanOrEqual(1_200_000);
    });

    it('has one watermark slot per page', () => {
      for (const [key, pdf] of variants) {
        expect(pdf.watermarkOffsets, key).toHaveLength(pdf.pages);
        expect(pdf.pages, key).toBeGreaterThan(0);
      }
    });

    // The offsets are only meaningful if the placeholder is genuinely at them,
    // uncompressed and literal. If pdf-lib ever compresses the overlay stream,
    // this is what says so — rather than a corrupt download.
    it('has the literal placeholder at every recorded offset', () => {
      for (const [key, pdf] of variants) {
        const bytes = Buffer.from(pdf.base64, 'base64');
        for (const offset of pdf.watermarkOffsets) {
          expect(
            bytes
              .subarray(offset, offset + WATERMARK_LENGTH)
              .toString('latin1'),
            `${key} @ ${offset}`,
          ).toBe(WATERMARK_PLACEHOLDER);
        }
      }
    });

    it('names a .pdf file for the download', () => {
      for (const [key, pdf] of variants) {
        expect(pdf.filename, key).toMatch(/^[\w-]+\.pdf$/);
      }
    });

    // Distinct filenames, or saving both leaves one overwritten in Downloads.
    it('gives the two variants different filenames', () => {
      expect(RESUME_PDFS.human.filename).not.toBe(RESUME_PDFS.bot.filename);
    });
  });
});
