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
  /** Git SHA of the build, stamped into every page by Layout.astro. */
  readonly PUBLIC_BUILD_SHA?: string;
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
