/**
 * The CV variants, and the only place that decides what a variant slug means.
 *
 * A slug is the key for the whole feature: it names a route, selects which
 * singleton sections the loader picks, and identifies a generated PDF. Four
 * consumers read this list — the loader, the chooser landing, the print routes
 * and scripts/resume-pdf.mjs — and a second list would drift from the first.
 * Same discipline, for the same reason, as CORPUS_COLLECTIONS in util/air.
 *
 * Registering a variant here does not publish it. `availableVariants()` in
 * load.ts asks the content collection which slugs actually have a profile
 * entry, so a registered variant with no prose 404s rather than rendering an
 * empty page or leaving a dead card on the landing.
 *
 * ## Why the filename suffix lives here and not in content
 *
 * It is not prose and it never changes with a reframe, but it does have to be
 * stable across a regeneration: a download whose filename changes between runs
 * leaves two copies in someone's Downloads folder. Content is resealed by hand
 * behind a key; this is not the kind of value that should need one to correct.
 *
 * ## No imports, on purpose
 *
 * This module is read by a plain node script, by the Worker, and by vitest.
 * Anything it imported would have to run in all three.
 */

/**
 * @typedef {object} Variant
 * @property {string} slug
 * @property {string} path Route path, with a trailing slash.
 * @property {string} filenameSuffix Appended before the kind, so the default
 *   variant keeps the filenames already in circulation.
 */

/** @type {ReadonlyArray<Variant>} */
export const VARIANTS = Object.freeze([
  Object.freeze({ slug: 'product', path: '/cv/product/', filenameSuffix: '' }),
  Object.freeze({
    slug: 'solutions',
    path: '/cv/solutions/',
    filenameSuffix: '-Solutions',
  }),
  Object.freeze({
    slug: 'leadership',
    path: '/cv/leadership/',
    filenameSuffix: '-Leadership',
  }),
]);

/**
 * The variant a bare request resolves to, and the fallback for any section a
 * variant does not override.
 */
export const DEFAULT_VARIANT = 'product';

/** The two renderings each variant is printed to. */
export const PDF_KINDS = Object.freeze(['human', 'bot']);

/**
 * @param {string} slug
 * @returns {Variant | undefined}
 */
export function variantBySlug(slug) {
  return VARIANTS.find((variant) => variant.slug === slug);
}

/**
 * @param {string} slug
 * @returns {boolean}
 */
export function isVariantSlug(slug) {
  return Boolean(variantBySlug(slug));
}

/**
 * The key a generated PDF is stored under.
 *
 * A composed string rather than a nested map: the generated module is written
 * by a script and read by an endpoint, and a flat map keeps both sides a single
 * lookup with no intermediate that can be undefined.
 *
 * @param {string} variant
 * @param {string} kind
 * @returns {string}
 */
export function pdfKey(variant, kind) {
  return `${variant}:${kind}`;
}

/**
 * The inverse of {@link pdfKey}, validating as it goes.
 *
 * Returns undefined rather than a partial parse, because every caller is
 * deciding whether to serve bytes. A key naming a variant that no longer exists
 * is a stale generated module, not a download.
 *
 * @param {string} key
 * @returns {{variant: string, kind: string} | undefined}
 */
export function parsePdfKey(key) {
  const [variant, kind, ...rest] = String(key).split(':');
  if (rest.length > 0) return undefined;
  if (!isVariantSlug(variant)) return undefined;
  if (!PDF_KINDS.includes(kind)) return undefined;
  return { variant, kind };
}

/**
 * @param {string} variant
 * @param {string} kind
 * @returns {string} e.g. `Eddie-Freeman-Resume-Solutions-ATS.pdf`
 */
export function pdfFilename(variant, kind) {
  const entry = variantBySlug(variant);
  if (!entry) throw new Error(`unknown resume variant: ${variant}`);
  const suffix = kind === 'bot' ? '-ATS' : '';
  return `Eddie-Freeman-Resume${entry.filenameSuffix}${suffix}.pdf`;
}
