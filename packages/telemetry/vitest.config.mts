/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

// Node, and it stays Node even once the browser adapter lands here.
//
// Nothing in this package touches a DOM. The vendor SDK is injected by the
// consumer rather than imported, so the adapter is tested against a fake object
// and never needs a window — which is the same property that lets one package
// serve workerd, Node, a browser and React Native without variants.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,mjs}'],
  },
});
