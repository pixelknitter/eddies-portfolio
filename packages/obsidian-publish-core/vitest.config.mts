/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

// No jsdom: this package is pure and must stay Node-free so the same code
// runs in workerd.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,mjs}'],
  },
});
