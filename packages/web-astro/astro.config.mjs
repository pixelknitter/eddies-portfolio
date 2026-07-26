import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from "@astrojs/cloudflare";
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  outDir: './dist',
  integrations: [react()],
  // Tailwind 4 is a Vite plugin; theme lives in src/styles/global.css.
  vite: {
    plugins: [tailwindcss()],
  },
  syntaxHighlight: 'prism',
  output: "server",
  adapter: cloudflare({
    // Serve images as-authored; avoids the build-time Cloudflare Images
    // (workerd) pipeline. Icons/webp assets here don't need optimization.
    imageService: 'passthrough',
    platformProxy: { enabled: false },
  })
});
