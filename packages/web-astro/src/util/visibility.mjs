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
 * Whether sample/fixture content (`sample-*.md`) is loaded into the content
 * collections.
 *
 * Fixtures are committed in plaintext because real posts exist in the repo only
 * as encrypted blobs: a build with no seal key — a fork pull request, or the
 * e2e suite asserting publication rules — would otherwise render nothing to
 * assert on. That makes them the one kind of content that must never appear
 * beside real work, so they load only where explicitly asked for.
 *
 * Note the absent DEV check, for the opposite reason to showHighlights: locally
 * you have the key and the real content, so fixtures would be pure clutter.
 * Useful in a preview when a branch's real content is thin and you want to see
 * a section's layout with something in it — hence the opt-in label rather than
 * a permanent setting.
 *
 * `DEV` is declared but unused so this accepts `import.meta.env` directly —
 * TypeScript rejects a call whose argument type shares no property with the
 * parameter type, and every other caller of these helpers passes that object.
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
