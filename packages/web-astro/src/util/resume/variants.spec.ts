import { describe, it, expect } from 'vitest';

import {
  VARIANTS,
  DEFAULT_VARIANT,
  PDF_KINDS,
  isVariantSlug,
  variantBySlug,
  pdfKey,
  parsePdfKey,
  pdfFilename,
} from './variants.mjs';

describe('variant registry', () => {
  it('gives every variant a unique slug and a unique path', () => {
    const slugs = VARIANTS.map((v) => v.slug);
    const paths = VARIANTS.map((v) => v.path);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('routes every variant under /cv/ with a trailing slash', () => {
    for (const variant of VARIANTS) {
      expect(variant.path, variant.slug).toBe(`/cv/${variant.slug}/`);
    }
  });

  it('includes the default variant', () => {
    expect(isVariantSlug(DEFAULT_VARIANT)).toBe(true);
  });

  // The dynamic route validates against this, so a sibling page's segment
  // resolving as a variant would be a 404 where a real page used to be.
  it('rejects a slug that is not registered', () => {
    expect(isVariantSlug('air')).toBe(false);
    expect(isVariantSlug('for-bots')).toBe(false);
    expect(isVariantSlug('print')).toBe(false);
    expect(variantBySlug('nope')).toBeUndefined();
  });

  it('round-trips a pdf key', () => {
    for (const variant of VARIANTS) {
      for (const kind of PDF_KINDS) {
        expect(parsePdfKey(pdfKey(variant.slug, kind))).toEqual({
          variant: variant.slug,
          kind,
        });
      }
    }
  });

  it('rejects a malformed pdf key', () => {
    expect(parsePdfKey('human')).toBeUndefined();
    expect(parsePdfKey('product:sideways')).toBeUndefined();
    expect(parsePdfKey('nope:human')).toBeUndefined();
  });

  // Two downloads landing in the same Downloads folder must not overwrite
  // each other, which is the invariant pdfs.spec.ts asserts on the artifacts.
  it('names a distinct file for every variant and kind', () => {
    const names = VARIANTS.flatMap((v) =>
      PDF_KINDS.map((kind) => pdfFilename(v.slug, kind)),
    );
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[\w-]+\.pdf$/);
  });

  it('keeps the default variant on the established filenames', () => {
    expect(pdfFilename('product', 'human')).toBe('Eddie-Freeman-Resume.pdf');
    expect(pdfFilename('product', 'bot')).toBe('Eddie-Freeman-Resume-ATS.pdf');
  });

  it('refuses to name a file for an unregistered variant', () => {
    expect(() => pdfFilename('nope', 'human')).toThrow(/unknown resume variant/);
  });
});
