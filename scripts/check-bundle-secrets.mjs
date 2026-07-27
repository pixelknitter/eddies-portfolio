#!/usr/bin/env node
/**
 * Fail the build if a secret was baked into the bundle.
 *
 * Astro serialises the build machine's entire `process.env` into the server
 * bundle so that `import.meta.env` works at runtime. That is by design, and it
 * means any secret present while `astro build` runs ends up as a string literal
 * inside `dist/server/` — and therefore inside the deployed Worker.
 *
 * This was found by grepping a local build and discovering a live
 * ANTHROPIC_API_KEY in it. CI does not currently export secrets into the build
 * step, so the deployed artifact is clean today; this gate is what keeps that
 * true when someone adds one.
 *
 * It cannot be fixed by neutralising `process.env.X` references — the inlining
 * is a wholesale object assignment, not a replaceable reference. Keeping the
 * build environment clean is the fix; this is how you find out you didn't.
 *
 * Usage: node scripts/check-bundle-secrets.mjs [dist-dir]
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? 'packages/web-astro/dist';

/** Shapes that are unambiguously credentials, not prose. */
const PATTERNS = [
  { name: 'Anthropic API key', re: /sk-ant-[a-z0-9-]{10,}/i },
  { name: 'OpenAI API key', re: /sk-(proj-)?[A-Za-z0-9]{32,}/ },
  { name: 'GitHub token', re: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'Slack token', re: /xox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Private key block', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Cloudflare API token', re: /\bCLOUDFLARE_API_TOKEN\s*[:=]\s*["'][^"']{20,}/ },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

const findings = [];
let scanned = 0;

for (const file of walk(root)) {
  if (!/\.(mjs|js|json|html|css|txt)$/.test(file)) continue;
  scanned += 1;

  const content = readFileSync(file, 'utf8');
  for (const { name, re } of PATTERNS) {
    const match = re.exec(content);
    if (match) {
      // Report a fingerprint, never the secret — this output lands in CI logs.
      findings.push(`${file}: ${name} (starts "${match[0].slice(0, 12)}…")`);
    }
  }
}

console.log(`Scanned ${scanned} built files under ${root}`);

if (findings.length > 0) {
  console.error('');
  console.error('✖ Secrets found in the build output:');
  for (const finding of findings) console.error(`  ${finding}`);
  console.error('');
  console.error('  Astro inlines the build machine\'s process.env into the server');
  console.error('  bundle. Remove the secret from the build environment — do not');
  console.error('  add it to the build step\'s `env:` block. Runtime secrets belong');
  console.error('  in Cloudflare (wrangler secret put) or .dev.vars locally.');
  process.exit(1);
}

console.log('✓ No secrets found in the build output.');
