import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  outDir: '../../dist/packages/web-astro',
  integrations: [react(), tailwind({ path: 'tailwind.config.cjs' })],
  syntaxHighlight: 'prism',
});
