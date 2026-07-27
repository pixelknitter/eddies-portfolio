/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly OPEN_AI_TOKEN: string;
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