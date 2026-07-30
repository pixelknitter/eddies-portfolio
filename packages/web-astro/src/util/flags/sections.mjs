import {
  showAIR,
  showBlog,
  showHighlights,
  showProjects,
  showResume,
  showResumePrint,
  showUnpublished,
} from '../visibility.mjs';
import { readRuntimeFlags } from './client.mjs';

/**
 * What is visible right now, from the build-time flags and a runtime override.
 *
 * ## Two layers, and the rule between them
 *
 * The `PUBLIC_SHOW_*` flags in `visibility.mjs` are substituted at build time, so a
 * flagged-off feature is not merely hidden — its code path is gone and its endpoint
 * 404s. `api/air/ask.ts` says why: "A flagged-off feature whose endpoint still
 * answers is not gated, it is merely unlinked." A flag fetched over the network
 * cannot make that promise, so it does not get to make it here either.
 *
 * The rule, applied below without exception:
 *
 * - **Content sections** (`blog`, `highlights`, `unpublished`) may be switched on
 *   *or* off at runtime. They gate rendering only — no endpoint, no secret, no
 *   money, no personal data. Toggling them cannot expose anything that was not
 *   already compiled in and harmless.
 * - **Gated features** (`air`, `resume`) may only be switched *off* at runtime. A
 *   kill switch is safe; a remote on-switch would mean production compiles in a
 *   model-spending endpoint and an address-collecting one, and reachability then
 *   depends on a third party being up and configured correctly.
 * - **Build-time only**: `projects` is prerendered, so `getStaticPaths` has already
 *   decided and no runtime flag can conjure a page that was never built.
 *   `resumePrint` renders the full resume *with* contact details as parseable HTML.
 *   `fixtures` swaps the content glob during the build. None of the three can be
 *   runtime anything.
 *
 * ## Missing an `await` fails closed
 *
 * `resolveSections` is async, so forgetting to await it yields a Promise, and
 * `promise.blog` is `undefined` — falsy, so the section stays hidden. The mistake
 * shows up as a missing section rather than an exposed one. That is deliberate; it
 * is also why these are not named `show*` like their synchronous counterparts, so
 * that a missed await is visible at the call site rather than silently truthy.
 */

/** Flag keys as they appear in PostHog. Kebab-case, namespaced by concern. */
export const SECTION_FLAGS = Object.freeze({
  blog: 'section-blog',
  highlights: 'section-highlights',
  unpublished: 'section-unpublished',
  air: 'section-air',
  resume: 'section-resume',
});

/** Runtime may set these either way. */
const CONTENT_SECTIONS = ['blog', 'highlights', 'unpublished'];

/** Runtime may only turn these off. */
const KILLABLE_SECTIONS = ['air', 'resume'];

/**
 * @param {Record<string, unknown>} [env]
 * @returns {Record<string, boolean>}
 */
export function buildTimeSections(env = {}) {
  return {
    blog: showBlog(env),
    highlights: showHighlights(env),
    unpublished: showUnpublished(env),
    air: showAIR(env),
    resume: showResume(env),
    projects: showProjects(env),
    resumePrint: showResumePrint(env),
    // Analytics is on exactly when there is a key to send to. Derived rather than
    // given its own flag so the two can never disagree.
    analytics: Boolean(env.PUBLIC_POSTHOG_KEY),
  };
}

/**
 * The policy, as a pure function so it can be tested without a network.
 *
 * @param {Record<string, boolean>} base Build-time values.
 * @param {Record<string, unknown> | null} flags Runtime flags, or `null` for none.
 * @returns {Readonly<Record<string, boolean>>}
 */
export function applyOverrides(base, flags) {
  const resolved = { ...base };

  if (flags) {
    for (const section of CONTENT_SECTIONS) {
      const value = flags[SECTION_FLAGS[section]];
      // Only a real boolean counts. A missing flag, a string variant, or a null
      // must leave the compiled value alone rather than coerce to false.
      if (typeof value === 'boolean') resolved[section] = value;
    }

    for (const section of KILLABLE_SECTIONS) {
      if (flags[SECTION_FLAGS[section]] === false) resolved[section] = false;
    }
  }

  /*
   * The privacy policy is reachable exactly when something collects data, which is
   * what makes it honest: no collection, nothing to disclose; any collection, and
   * the page is there. Derived rather than flagged so it cannot drift out of step
   * with the features it describes.
   */
  resolved.collectsData = Boolean(
    resolved.air || resolved.resume || resolved.analytics,
  );

  return Object.freeze(resolved);
}

/**
 * @param {Record<string, unknown>} [env]
 * @param {{ now?: number, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<Readonly<Record<string, boolean>>>}
 */
export async function resolveSections(env = {}, options = {}) {
  const flags = await readRuntimeFlags(env, options);
  return applyOverrides(buildTimeSections(env), flags);
}
