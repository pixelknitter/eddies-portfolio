#!/usr/bin/env node
/**
 * Fail the build if a gated file is servable as a public asset.
 *
 * The resume PDFs are compiled into the Worker precisely so no PDF exists at a
 * public URL: the download endpoint requires a signed token, and if the same bytes
 * were also sitting in `dist/client` the token would be decoration. Cloudflare's
 * asset handler answers *before* the Worker runs, so anything in there is reachable
 * by anyone who guesses the path.
 *
 * ## Why a filename check is not enough
 *
 * Guessing URLs can only find files someone thought to name. This walks the asset
 * tree and reads the first five bytes of every file, so a PDF committed as
 * `resume.bin` or `brochure.webp` is caught too. That is the check that cannot be
 * fooled by a name nobody predicted.
 *
 * Runs alongside check-bundle-secrets.mjs in CI and before both deploys — the point
 * is to fail *before* a leak reaches the edge, since git history is append-only and
 * an asset that shipped once may already be cached.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Directories whose contents become publicly fetchable. */
const PUBLIC_ROOTS = [
  'packages/web-astro/dist/client',
  'packages/web-astro/public',
];

/**
 * File types that must never be public.
 *
 * Keyed on magic bytes rather than extension. PDFs are the live case; the others
 * are here because the same reasoning applies to any document that would carry
 * contact details or unpublished content.
 */
const FORBIDDEN_MAGIC = [
  { name: 'PDF', bytes: Buffer.from('%PDF-') },
  // A sealed content blob in the asset tree would publish exactly what the vault
  // exists to keep out of the repo.
  { name: 'sealed blob', bytes: Buffer.from('SEALEDV2') },
];

const FORBIDDEN_EXTENSIONS = ['.pdf', '.sealed'];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

const violations = [];
let scanned = 0;

for (const root of PUBLIC_ROOTS) {
  if (!existsSync(root)) continue;

  for (const path of walk(root)) {
    scanned += 1;
    const rel = relative(process.cwd(), path);

    const lower = path.toLowerCase();
    const badExtension = FORBIDDEN_EXTENSIONS.find((ext) =>
      lower.endsWith(ext),
    );
    if (badExtension) {
      violations.push(`${rel} — ${badExtension} files must not be public`);
      continue;
    }

    // Read only the header: the asset tree can hold large media, and the magic
    // bytes are all this needs.
    let head;
    try {
      const handle = readFileSync(path);
      head = handle.subarray(0, 8);
    } catch {
      continue;
    }

    for (const { name, bytes } of FORBIDDEN_MAGIC) {
      if (head.subarray(0, bytes.length).equals(bytes)) {
        violations.push(`${rel} — looks like a ${name} regardless of its name`);
        break;
      }
    }
  }
}

if (violations.length > 0) {
  console.error(
    `✘ ${violations.length} gated file(s) are publicly servable:\n`,
  );
  for (const violation of violations) console.error(`  ${violation}`);
  console.error(
    '\nCloudflare serves dist/client before the Worker runs, so these are reachable\n' +
      'without a token. The resume PDFs belong in the Worker bundle — see\n' +
      'packages/web-astro/src/util/resume/pdfs.generated.mjs and `yarn resume:pdf`.',
  );
  process.exit(1);
}

console.log(
  `Scanned ${scanned} public asset(s) under ${PUBLIC_ROOTS.join(', ')}`,
);
console.log('✓ No gated files are publicly servable.');
