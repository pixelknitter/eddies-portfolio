/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  /**
   * Server-only secrets for A.I.R. No PUBLIC_ prefix on purpose — a prefixed
   * name is substituted into the client bundle, which is exactly wrong for a
   * model key and an access code. These are read from the Cloudflare runtime
   * env at request time; `import.meta.env` only resolves them in local dev.
   */
  readonly ANTHROPIC_API_KEY?: string;
  readonly AIR_ACCESS_CODE?: string;
  /**
   * Build-time feature flags. The PUBLIC_ prefix is required: Vite only
   * substitutes prefixed names into import.meta.env, so a bare name is
   * silently inert.
   */
  readonly PUBLIC_SHOW_UNPUBLISHED?: string;
  readonly PUBLIC_SHOW_AIR?: string;
  readonly PUBLIC_SHOW_BLOG?: string;
  readonly PUBLIC_SHOW_PROJECTS?: string;
  readonly PUBLIC_SHOW_HIGHLIGHTS?: string;
  /** The resume pages. Independent of A.I.R. — see showResume. */
  readonly PUBLIC_SHOW_RESUME?: string;
  /**
   * Reachability of the print-only resume render routes. Set by
   * scripts/resume-pdf.mjs for the duration of a generation build and by
   * nothing else — no deploy workflow sets it, so those routes 404 on every
   * deployed tier. See showResumePrint in util/visibility.mjs.
   */
  readonly PUBLIC_RESUME_PRINT?: string;
  /** Git SHA of the build, stamped into every page by Layout.astro. */
  readonly PUBLIC_BUILD_SHA?: string;
  /**
   * PostHog project token. PUBLIC_ on purpose and correct: the project token is
   * write-only, is designed to ship to browsers, and is what the public /flags
   * endpoint authenticates with. Its presence is also what `buildTimeSections`
   * reads as "analytics is on", which is what makes the privacy policy reachable.
   *
   * A *personal* PostHog API key is the opposite of this and must never appear
   * here — it would be inlined into the server bundle, and
   * check-bundle-secrets.mjs has no pattern for it yet.
   */
  readonly PUBLIC_POSTHOG_KEY?: string;
  /**
   * PostHog ingest host. Defaults to https://us.i.posthog.com when unset; set it
   * to a reverse-proxy subdomain to keep requests first-party.
   */
  readonly PUBLIC_POSTHOG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

type Badge = {
  label: string;
  tech: string;
  iconSuffix?: string;
  src?: string;
}

type BlockCategory = 'Languages' | 'Frameworks' | 'Platforms' | 'Tools' | 'Infrastructure' | 'Analytics';
/**
 * Provided by the Workers runtime, not by a package — Astro 7 reads Cloudflare
 * secrets and bindings through it. Declared here so `astro check` can resolve
 * the dynamic import in the A.I.R. endpoint.
 */
declare module 'cloudflare:workers' {
  export const env: Record<string, string | undefined>;
}
