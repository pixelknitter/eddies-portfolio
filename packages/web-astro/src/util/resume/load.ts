import { getCollection } from 'astro:content';

import { showFixtures } from '../visibility.mjs';

import { assembleVariant, hasVariantProfile } from './assemble';
import { DEFAULT_VARIANT, VARIANTS, isVariantSlug } from './variants.mjs';

import type { Resume, ResumeEntry } from './assemble';

/**
 * Read the resume out of the content collection, in a given framing.
 *
 * The assembly rules live in `assemble.ts`, which depends on `astro:content`
 * for types only and is therefore testable. This file is the half that cannot
 * be: it calls `getCollection`, which resolves only inside an Astro build.
 *
 * ## Empty means missing, not empty
 *
 * The content is sealed. A build with no `CONTENT_SEAL_KEY` and no fixtures
 * loads zero entries, and every resume route 404s rather than publishing a
 * header with seven empty sections and a JSON-LD graph asserting a person with
 * no work history. `loadResume` returns null for that case; the routes check it.
 */

export type { Resume, SectionName } from './assemble';
export { assembleVariant } from './assemble';

/** One chooser card on /cv. */
export interface VariantCard {
  slug: string;
  path: string;
  headline: string;
  pitch: string;
}

/**
 * Every entry that is real, or every fixture, but never a mix.
 *
 * Split out because three callers need the same selection — loading a variant,
 * listing which variants exist, and building the chooser cards — and repeating
 * the rule is how it would drift.
 */
async function selectEntries(): Promise<ResumeEntry[]> {
  const all = await getCollection('resume');
  if (all.length === 0) return [];

  /*
   * Fixtures fill in only when there is nothing real — the rule
   * `scripts/air-eval.mjs` already uses on its corpus. Without it, a build with
   * both (seal key present *and* PUBLIC_SHOW_FIXTURES on) could pick the sample
   * profile over the real one, because the singleton sections take the first
   * match. A sample headline mixed into a real resume is worse than either
   * alone, and invisible until someone reads the page.
   *
   * The flag is checked *here* rather than left to `CONTENT_GLOB`, which cannot
   * do it for this collection: its negation pattern for `sample-` files excludes
   * a fixture at a collection's root — star's does not reach the bundle — but
   * not one a directory deep, and the resume uses a directory per section.
   * Measured, not assumed. So the filename convention is not load-bearing here;
   * this check is.
   */
  const real = all.filter((entry) => !entry.id.includes('sample-'));
  if (real.length > 0) return real;

  return showFixtures(import.meta.env) ? all : [];
}

/**
 * @param variant A registered variant slug. An unknown slug returns null rather
 *   than falling back, so a typo in a link is a 404 and not a silent redirect to
 *   a different framing of the same career.
 * @returns The assembled resume, or null when there is nothing to assemble —
 *   which means the seal key is absent, or this variant is unwritten.
 */
export async function loadResume(
  variant: string = DEFAULT_VARIANT,
): Promise<Resume | null> {
  if (!isVariantSlug(variant)) return null;

  const entries = await selectEntries();
  if (entries.length === 0) return null;

  // A registered variant with no profile of its own is not published. Only the
  // default falls back, because the default *is* the fallback.
  if (variant !== DEFAULT_VARIANT && !hasVariantProfile(entries, variant)) {
    return null;
  }

  return assembleVariant(entries, variant);
}

/**
 * Which variants are actually publishable right now.
 *
 * Registry order, so the chooser lays cards out deliberately rather than in
 * whatever order the content glob happened to return. The default is included
 * whenever there is any content at all; the others have to earn it with a
 * profile entry. That is what keeps an unwritten variant off the landing
 * instead of leaving a card that leads to a 404.
 */
export async function availableVariants(): Promise<string[]> {
  const entries = await selectEntries();
  if (entries.length === 0) return [];

  return VARIANTS.filter(
    (variant) =>
      variant.slug === DEFAULT_VARIANT ||
      hasVariantProfile(entries, variant.slug),
  ).map((variant) => variant.slug);
}

/**
 * The chooser cards, in registry order.
 *
 * Card copy comes from each variant's sealed profile rather than from the
 * landing page, so a new variant appears the moment its prose is sealed and no
 * code change is needed to introduce it.
 */
export async function variantCards(): Promise<VariantCard[]> {
  const entries = await selectEntries();
  if (entries.length === 0) return [];

  const cards: VariantCard[] = [];

  for (const variant of VARIANTS) {
    if (
      variant.slug !== DEFAULT_VARIANT &&
      !hasVariantProfile(entries, variant.slug)
    ) {
      continue;
    }

    const resume = assembleVariant(entries, variant.slug);
    cards.push({
      slug: variant.slug,
      path: variant.path,
      headline: resume.headline,
      // A card with no pitch still renders; the headline carries it.
      pitch: resume.pitch ?? '',
    });
  }

  return cards;
}
