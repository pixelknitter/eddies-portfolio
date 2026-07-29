/**
 * Access to the Cloudflare Workers runtime environment.
 *
 * Astro 7 exposes secrets and bindings through `cloudflare:workers`;
 * `Astro.locals.runtime.env` was removed in Astro 6 and throws if touched.
 *
 * There is deliberately no `import.meta.env` fallback for secrets. Astro
 * serialises the build machine's entire process.env into the server bundle, so
 * reading secrets from it would encourage exactly the pattern that put a live
 * API key into dist/ during development. Locally, use
 * `packages/web-astro/.dev.vars`, which populates this same runtime env.
 */

/** @returns {Promise<Record<string, unknown> | undefined>} */
async function runtimeEnv() {
  try {
    const { env } = await import(/* @vite-ignore */ 'cloudflare:workers');
    return env;
  } catch {
    // Not running on Workers (astro dev, vitest).
    return undefined;
  }
}

/**
 * Read a secret. Empty strings are treated as unset — a blank secret is a
 * misconfiguration, and letting it through would silently weaken a gate.
 *
 * @param {string} key
 * @returns {Promise<string | undefined>}
 */
export async function readSecret(key) {
  const env = await runtimeEnv();
  const value = env?.[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Read a binding (KV, send_email, and so on).
 *
 * @param {string} key
 * @returns {Promise<unknown>}
 */
export async function readBinding(key) {
  return (await runtimeEnv())?.[key];
}
