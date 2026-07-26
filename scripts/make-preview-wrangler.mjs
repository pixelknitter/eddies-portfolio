#!/usr/bin/env node
/**
 * Generate a preview Wrangler config from the adapter-generated one.
 *
 * Preview URLs cannot be served on a custom domain
 * (https://developers.cloudflare.com/workers/configuration/previews/), so a
 * per-PR preview that needs a real hostname has to be its own Worker with its
 * own Custom Domain rather than a version of the production Worker.
 *
 * This reads `dist/server/wrangler.json` (written by @astrojs/cloudflare) and
 * writes a sibling config with:
 *   - `name`   replaced by the preview Worker name
 *   - `routes` REPLACED (never appended) by the preview Custom Domain, so a
 *              preview can never claim the production hostname
 *   - `kv_namespaces` pinned to a shared namespace when one is supplied,
 *              avoiding a new namespace per preview Worker
 *
 * It is written next to the original because `main` and `assets.directory`
 * are resolved relative to the config file.
 *
 * Usage:
 *   node scripts/make-preview-wrangler.mjs <worker-name> <hostname> [session-kv-id]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [workerName, hostname, sessionKvId] = process.argv.slice(2);

if (!workerName || !hostname) {
  console.error('Usage: make-preview-wrangler.mjs <worker-name> <hostname> [session-kv-id]');
  process.exit(1);
}

// Guard the values that end up in a Worker name / DNS label.
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const HOST_RE = /^[a-z0-9][a-z0-9-]{0,62}(\.[a-z0-9][a-z0-9-]{0,62})+$/;

if (!NAME_RE.test(workerName)) {
  console.error(`✖ Invalid worker name: ${JSON.stringify(workerName)}`);
  process.exit(1);
}
if (!HOST_RE.test(hostname)) {
  console.error(`✖ Invalid hostname: ${JSON.stringify(hostname)}`);
  process.exit(1);
}

const sourcePath = 'packages/web-astro/dist/server/wrangler.json';
const outPath = join(dirname(sourcePath), 'wrangler.preview.json');

const config = JSON.parse(readFileSync(sourcePath, 'utf8'));

config.name = workerName;
// Replace, never append — this is what keeps a preview off the production
// hostname even though it inherits the rest of the production config.
config.routes = [{ pattern: hostname, custom_domain: true }];

if (Array.isArray(config.kv_namespaces) && config.kv_namespaces.length && sessionKvId) {
  config.kv_namespaces = config.kv_namespaces.map((ns) => ({ ...ns, id: sessionKvId }));
}

writeFileSync(outPath, JSON.stringify(config, null, 2) + '\n');

console.log(`Preview config written to ${outPath}`);
console.log(`  name:   ${config.name}`);
console.log(`  domain: ${hostname}`);
console.log(`  kv:     ${JSON.stringify(config.kv_namespaces ?? [])}`);
