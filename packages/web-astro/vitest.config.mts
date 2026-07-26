/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

// A lean, framework-agnostic test config: it avoids loading the Astro
// Cloudflare adapter (which otherwise keeps the process alive) and stays
// stable across Astro/React/Tailwind upgrades. Unit tests here cover plain
// TS modules and React islands; Astro component rendering is validated by
// the `build` target in CI.
export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
