/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

// No jsdom. This package is pure and must stay Node-free so the identical code
// runs in workerd, and so the browser adapter can import its redactor rather
// than growing a second copy of the one guarantee that must not diverge.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,mjs}'],
  },
});
