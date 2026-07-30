/// <reference types="vitest" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// A lean, framework-agnostic test config: it avoids loading the Astro
// Cloudflare adapter (which otherwise keeps the process alive) and stays
// stable across Astro/React/Tailwind upgrades. Unit tests here cover plain
// TS modules and React islands; Astro component rendering is validated by
// the `build` target in CI.
/** Mirrors the `paths` in tsconfig.json — see the note on `resolve.alias`. */
const alias = Object.fromEntries(
  ['components', 'layouts', 'content', 'static', 'util'].map((name) => [
    `@${name}`,
    fileURLToPath(new URL(`./src/${name}`, import.meta.url)),
  ])
);

export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  // Without these, anything importing `@util/…` cannot be loaded by a test —
  // which excluded every file under src/pages, since pages use the aliases while
  // src/util modules import each other relatively. Endpoint handlers are plain
  // functions over Request/Response and are worth testing directly, especially
  // the ones whose behaviour depends on the request host: `wrangler dev` rewrites
  // Host to the custom domain in wrangler.jsonc, so a per-tier branch is not
  // observable over local HTTP at all (see util/air/tier.mjs).
  resolve: { alias },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
