import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from "@astrojs/cloudflare";
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  outDir: './dist',
  // The canonical origin, always production — never the host actually serving
  // the request. The resume's JSON-LD graph has to state absolute URLs, and a
  // staging build that emitted staging URLs would offer search and generative
  // engines a second, competing copy of the same person. Per-tier hostnames are
  // derived at request time instead; see util/air/tier.mjs.
  site: 'https://eddie.engineering',
  integrations: [react()],
  // Tailwind 4 is a Vite plugin; theme lives in src/styles/global.css.
  vite: {
    plugins: [tailwindcss()],
  },
  // Astro's <Image> refuses remote sources unless the host is allowed.
  // Sample project artwork comes from a placeholder generator.
  image: {
    domains: ['placehold.co'],
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
