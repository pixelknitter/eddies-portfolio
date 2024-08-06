/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly OPEN_AI_TOKEN: string;
  // more env variables...
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