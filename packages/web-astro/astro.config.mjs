import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

const tailwindOptions = {
  configFile: './packages/web-astro/tailwind.config.cjs'
}

export default defineConfig({
  outDir: '../../dist/packages/web-astro',
  integrations: [react(), tailwind(tailwindOptions)],
  syntaxHighlight: 'prism',
});
