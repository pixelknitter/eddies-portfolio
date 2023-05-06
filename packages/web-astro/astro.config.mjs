import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import solid from '@astrojs/solid-js';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  outDir: '../../dist/packages/web-astro',
  integrations: [react(), solid(), tailwind()],
});
