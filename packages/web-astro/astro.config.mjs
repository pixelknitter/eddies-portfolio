import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import cloudflare from "@astrojs/cloudflare";
const tailwindOptions = {
  configFile: './packages/web-astro/tailwind.config.cjs'
}

export default defineConfig({
  outDir: '../../dist/packages/web-astro',
  integrations: [react(), tailwind(tailwindOptions)],
  syntaxHighlight: 'prism',
  output: "server",
  adapter: cloudflare(),
  server: {
    headers: {
      'Permissions-Policy': 'run-ad-auction=(), private-state-token-redemption=(), private-state-token-issuance=(), join-ad-interest-group=(), browsing-topics=()'
    }
  }
});
