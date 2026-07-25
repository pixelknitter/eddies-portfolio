import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import cloudflare from "@astrojs/cloudflare";
const tailwindOptions = {
  // Resolved relative to this config's directory (the Astro CLI runs with
  // its cwd set to the package root).
  configFile: './tailwind.config.cjs'
}

export default defineConfig({
  outDir: '../../dist/packages/web-astro',
  integrations: [react(), tailwind(tailwindOptions)],
  syntaxHighlight: 'prism',
  output: "server",
  adapter: cloudflare()
});
