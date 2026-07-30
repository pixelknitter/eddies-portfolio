/**
 * Whether unpublished content (drafts and not-yet-due posts) should be shown.
 *
 * Production shows only published content. Local dev and the dev/staging
 * deploys show everything, so a reviewer can actually see the blog, STAR and
 * project sections working — those tiers build in production mode, so
 * `import.meta.env.PROD` alone would leave them looking empty.
 *
 * Set PUBLIC_SHOW_UNPUBLISHED=true in a build to reveal unpublished content.
 * The PUBLIC_ prefix is required — Vite only substitutes prefixed names into
 * `import.meta.env`, so a bare name would silently never take effect.
 *
 * @param {{DEV?: boolean, PUBLIC_SHOW_UNPUBLISHED?: string | boolean}} env
 * @returns {boolean}
 */
export function showUnpublished(env = {}) {
  if (env.DEV === true) return true;
  return String(env.PUBLIC_SHOW_UNPUBLISHED ?? '') === 'true';
}

/**
 * Whether the A.I.R. (AI resume) page is enabled.
 *
 * A build-time flag rather than a hosted feature-flag service: Cloudflare has
 * no first-party flag product, and a plain env var costs nothing and adds no
 * runtime dependency. Toggling requires a deploy — move the read to Workers
 * KV if flipping without one is worth a per-request lookup.
 *
 * @param {{PUBLIC_SHOW_AIR?: string | boolean}} env
 * @returns {boolean}
 */
export function showAIR(env = {}) {
  return flagEnabled(env.PUBLIC_SHOW_AIR);
}

/**
 * Whether the blog section is enabled.
 * @param {{PUBLIC_SHOW_BLOG?: string | boolean}} env
 */
export function showBlog(env = {}) {
  return flagEnabled(env.PUBLIC_SHOW_BLOG);
}

/**
 * Whether the STAR career highlights section is enabled.
 *
 * Off until there are real stories to show. Draft filtering alone was doing
 * this job by accident — every entry happened to be a draft — which meant
 * marking one story publishable would have put the section live with no
 * switch to hold it back.
 *
 * Note the absent DEV check: unlike showUnpublished, dev does not imply on.
 * The section is hidden because the stories are not written yet, and that is
 * equally true locally.
 *
 * @param {{DEV?: boolean, PUBLIC_SHOW_HIGHLIGHTS?: string | boolean}} env
 */
export function showHighlights(env = {}) {
  return flagEnabled(env.PUBLIC_SHOW_HIGHLIGHTS);
}

/**
 * Whether the projects/works section is enabled.
 * @param {{PUBLIC_SHOW_PROJECTS?: string | boolean}} env
 */
export function showProjects(env = {}) {
  return flagEnabled(env.PUBLIC_SHOW_PROJECTS);
}

/**
 * Whether the print-only resume render routes are reachable.
 *
 * These routes exist for one reason: `scripts/resume-pdf.mjs` points a headless
 * browser at them to produce the downloadable PDFs. They are the same leak the
 * gated PDFs are — the full resume, contact details included, in a *more*
 * parseable form than a PDF — so they need the same gate.
 *
 * Hence a flag separate from showAIR, set only by the generation build and by
 * nothing else. No deploy workflow sets it, so the routes 404 on every tier
 * including production. That is the intended steady state, not an oversight:
 * the PDFs are generated locally and committed, so production never needs to
 * render one.
 *
 * Note the absent DEV check. Dev does not imply on, because the routes bypass
 * the contact-hiding the visible resume relies on — reaching them should always
 * be a deliberate act. Set PUBLIC_RESUME_PRINT=true to iterate on the print
 * layout locally.
 *
 * @param {{DEV?: boolean, PUBLIC_RESUME_PRINT?: string | boolean}} env
 */
export function showResumePrint(env = {}) {
  return flagEnabled(env.PUBLIC_RESUME_PRINT);
}

/**
 * Whether sample fixtures (`sample-*.md`) are loaded into the collections.
 *
 * Off by default, including in dev: they exist so a keyless build (fork CI, the
 * e2e suite) has content to assert on, and must never appear beside real work.
 * The e2e build and the `show-fixtures` PR label turn them on.
 *
 * `DEV` is declared but unused so this accepts `import.meta.env` — TypeScript
 * rejects an argument sharing no property with the parameter type.
 *
 * @param {{DEV?: boolean, PUBLIC_SHOW_FIXTURES?: string | boolean}} env
 */
export function showFixtures(env = {}) {
  return flagEnabled(env.PUBLIC_SHOW_FIXTURES);
}

/**
 * Flags are opt-in and must be the exact string "true".
 *
 * Env vars arrive as strings, so a loose truthy check would treat "false"
 * as enabled — the failure mode being guarded against is an unfinished
 * section appearing in production.
 *
 * @param {string | boolean | undefined} value
 */
function flagEnabled(value) {
  return String(value ?? '') === 'true';
}
