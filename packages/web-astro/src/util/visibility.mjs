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
 * Whether the projects/works section is enabled.
 * @param {{PUBLIC_SHOW_PROJECTS?: string | boolean}} env
 */
export function showProjects(env = {}) {
  return flagEnabled(env.PUBLIC_SHOW_PROJECTS);
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
