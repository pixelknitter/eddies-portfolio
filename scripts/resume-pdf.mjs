#!/usr/bin/env node
/**
 * Generate the two downloadable resume PDFs.
 *
 * Builds the app with the print routes enabled, serves the real Worker, prints
 * both routes with Chromium, stamps a patchable watermark slot into each page,
 * and writes `src/util/resume/pdfs.generated.mjs` for the download endpoint to
 * serve. Run it with `yarn resume:pdf` and commit the result.
 *
 * ## Why it runs its own build and server
 *
 * The print routes are gated behind `PUBLIC_RESUME_PRINT`, which nothing else
 * sets — they 404 on every deployed tier because they render the full resume
 * *with* contact details as parseable HTML, which is the thing the download gate
 * exists to protect. So the only place they exist is a build this script drives.
 *
 * It serves the built Worker rather than `astro dev`, for the reasons
 * `packages/web-astro-e2e/playwright.config.ts` already documents: `astro dev`
 * daemonises and the parent only ever sees the process exit, and serving the build
 * exercises the artifact that deploys. It also uses its own port, because a
 * `wrangler dev` started before a rebuild keeps serving the previous asset
 * snapshot — the page returns 200 while every stylesheet 404s, which looks like a
 * broken document and is not.
 *
 * Usage:
 *   yarn resume:pdf
 *   yarn resume:pdf --base-url http://127.0.0.1:4321   # skip build+serve
 *   yarn resume:pdf --only human
 *   yarn resume:pdf --keep-pdf                         # also write the raw files
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';
import {
  PDFDocument,
  StandardFonts,
  PDFRawStream,
  PDFName,
  PDFArray,
} from 'pdf-lib';

import {
  WATERMARK_LENGTH,
  WATERMARK_PLACEHOLDER,
} from '../packages/web-astro/src/util/resume/watermark.mjs';
import { resumeFingerprint } from '../packages/web-astro/src/util/resume/fingerprint.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(REPO, 'packages/web-astro');
const OUT = join(APP, 'src/util/resume/pdfs.generated.mjs');

/** Not 4321: that is the e2e/dev port, and colliding produces a stale-asset server. */
const PORT = 4319;

/**
 * Size budget, enforced rather than advised.
 *
 * The bundle ceiling is 3 MB compressed on Workers Free and base64 costs ~1% once
 * gzip runs, so these leave room for the rest of the Worker to grow. A
 * print-background-heavy document with photographs is the realistic way to blow it.
 */
const MAX_PDF_BYTES = 600_000;
const MAX_TOTAL_BYTES = 1_200_000;

const VARIANTS = [
  {
    key: 'human',
    path: '/air/resume/print/human',
    filename: 'Eddie-Freeman-Resume.pdf',
    printBackground: true,
    // The organic document; these are the families PrintLayout loads for it.
    fonts: ['400 42px "Caprasimo"', '400 16px "Figtree"'],
  },
  {
    key: 'bot',
    path: '/air/resume/print/bot',
    filename: 'Eddie-Freeman-Resume-ATS.pdf',
    // Light on white: smaller, and what an ATS expects to be handed.
    printBackground: false,
    // Deliberately none — the plain variant forces a system stack precisely so it
    // embeds no webfont and needs no network at generation time.
    fonts: [],
  },
];

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};

const only = value('only');
const baseUrlOverride = value('base-url');
const keepPdf = flag('keep-pdf');

const variants = only ? VARIANTS.filter((v) => v.key === only) : VARIANTS;
if (variants.length === 0) {
  console.error(
    `--only must be one of: ${VARIANTS.map((v) => v.key).join(', ')}`,
  );
  process.exit(1);
}

const log = (...args) => console.log('[resume-pdf]', ...args);

/** Run a command to completion, inheriting stdio so failures are readable. */
function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

/** Poll until the server answers, so we never print a half-started Worker. */
async function waitForServer(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      // Any answer proves the Worker is up. A 404 here would mean the flag did not
      // take, which is checked separately and more usefully below.
      if (response.status < 500) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not answer at ${url} within ${timeoutMs}ms`);
}

/**
 * Stamp a patchable watermark slot into every page.
 *
 * The run has to end up **uncompressed and literal** in the file, or the endpoint
 * has nothing to find. Two things make that true, and both are easy to undo:
 *
 *   - The overlay is appended as its own `PDFRawStream` with no `/Filter`. Text
 *     drawn through `page.drawText` lands in a Flate-compressed stream as a hex
 *     string instead, where no literal placeholder exists.
 *   - The font is standard-14 Helvetica, which is not subset, so every WinAnsi
 *     character has a glyph. A subset font would carry only the `#` glyphs drawn
 *     here, and substituting an email address would reference glyphs the document
 *     does not contain.
 *
 * @returns {Promise<{bytes: Uint8Array, offsets: number[], pages: number}>}
 */
async function stampWatermarkSlot(pdfBytes) {
  const doc = await PDFDocument.load(pdfBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const page of doc.getPages()) {
    // Draw nothing visible, purely to get the font into this page's resources so
    // the raw stream below has a name to reference.
    page.drawText(' ', { x: 0, y: 0, size: 1, font });

    const fontDict = page.node.Resources().lookup(PDFName.of('Font'));
    const names = fontDict.keys();
    const resourceName = names[names.length - 1].asString().replace('/', '');

    // 24pt from the bottom-left, small and grey enough to sit under the content
    // without competing with it.
    const operators = [
      'q',
      'BT',
      `/${resourceName} 6 Tf`,
      '0.45 0.45 0.45 rg',
      '1 0 0 1 40 18 Tm',
      `(${WATERMARK_PLACEHOLDER}) Tj`,
      'ET',
      'Q',
      '',
    ].join('\n');

    const encoded = new TextEncoder().encode(operators);
    const stream = PDFRawStream.of(
      doc.context.obj({ Length: encoded.length }),
      encoded,
    );
    const ref = doc.context.register(stream);

    const contents = page.node.get(PDFName.of('Contents'));
    let array = contents;
    if (!(contents instanceof PDFArray)) {
      array = doc.context.obj([]);
      array.push(contents);
      page.node.set(PDFName.of('Contents'), array);
    }
    array.push(ref);
  }

  // `useObjectStreams: false` keeps top-level objects addressable in the file
  // rather than packed into compressed object streams.
  const bytes = await doc.save({ useObjectStreams: false });

  const buffer = Buffer.from(bytes);
  const needle = Buffer.from(WATERMARK_PLACEHOLDER, 'latin1');
  const offsets = [];
  let index = 0;
  while ((index = buffer.indexOf(needle, index)) !== -1) {
    offsets.push(index);
    index += needle.length;
  }

  const pages = doc.getPageCount();
  if (offsets.length !== pages) {
    throw new Error(
      `expected one watermark slot per page (${pages}), found ${offsets.length}. ` +
        'pdf-lib may now compress the overlay stream — see stampWatermarkSlot().',
    );
  }

  return { bytes, offsets, pages };
}

async function main() {
  const baseUrl = baseUrlOverride ?? `http://127.0.0.1:${PORT}`;
  let server;

  try {
    if (!baseUrlOverride) {
      log('building with the print routes enabled…');
      await run('npx', ['astro', 'build'], {
        cwd: APP,
        env: {
          ...process.env,
          PUBLIC_RESUME_PRINT: 'true',
          PUBLIC_SHOW_AIR: 'true',
        },
      });

      log(`serving the built Worker on ${PORT}…`);
      server = spawn(
        'npx',
        [
          'wrangler',
          'dev',
          '-c',
          'dist/server/wrangler.json',
          '--port',
          String(PORT),
          '--local',
          // Let wrangler pick a free inspector port; a fixed one collides with a
          // dev server someone left running.
          '--inspector-port',
          '0',
        ],
        { cwd: APP, stdio: 'ignore', detached: false },
      );
      await waitForServer(`${baseUrl}/air/resume/`);
    }

    const browser = await chromium.launch();
    const generated = {};

    try {
      for (const variant of variants) {
        const page = await browser.newPage();
        // Never inherit a dark colour scheme: the print layout does not run the
        // site's theme script, but emulation would still apply media queries.
        await page.emulateMedia({ colorScheme: 'light', forcedColors: 'none' });

        const url = `${baseUrl}${variant.path}`;
        const response = await page.goto(url, { waitUntil: 'networkidle' });
        if (!response || !response.ok()) {
          throw new Error(
            `${url} returned ${response?.status()}. The print routes need ` +
              'PUBLIC_RESUME_PRINT=true; check it is in project.json build.inputs, ' +
              'or Nx will serve a cached build in which they 404.',
          );
        }

        // Webfonts load lazily — a face is only fetched when rendered text matches
        // it. Asserting rather than trusting, because a silent fallback to a system
        // face is a visual regression nobody notices until the file is opened.
        await page.evaluate(() => document.fonts.ready);
        for (const spec of variant.fonts) {
          const loaded = await page.evaluate(
            (s) => document.fonts.check(s),
            spec,
          );
          if (!loaded)
            throw new Error(`${variant.key}: webfont did not load: ${spec}`);
        }

        // `preferCSSPageSize` makes `format` and `margin` no-ops: page geometry
        // lives only in `@page` in print.css. `tagged` gives the PDF a structure
        // tree, so parsers get real headings and lists rather than glyph runs —
        // it defaults to false, and it is the highest-leverage option here.
        const raw = await page.pdf({
          preferCSSPageSize: true,
          printBackground: variant.printBackground,
          tagged: true,
          outline: false,
          scale: 1,
        });
        await page.close();

        const { bytes, offsets, pages } = await stampWatermarkSlot(raw);

        if (bytes.length > MAX_PDF_BYTES) {
          throw new Error(
            `${variant.key} is ${bytes.length} bytes, over the ${MAX_PDF_BYTES} budget. ` +
              'Trim the document, or move the PDFs to R2 and read them through a binding.',
          );
        }

        generated[variant.key] = {
          base64: Buffer.from(bytes).toString('base64'),
          bytes: bytes.length,
          pages,
          watermarkOffsets: offsets,
          filename: variant.filename,
        };

        log(
          `${variant.key}: ${pages} pages, ${(bytes.length / 1024).toFixed(0)}KB, ${offsets.length} watermark slots`,
        );

        if (keepPdf) {
          const dir = join(APP, 'dist/resume-preview');
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, variant.filename), bytes);
        }
      }
    } finally {
      await browser.close();
    }

    const total = Object.values(generated).reduce((sum, v) => sum + v.bytes, 0);
    if (total > MAX_TOTAL_BYTES) {
      throw new Error(
        `combined ${total} bytes is over the ${MAX_TOTAL_BYTES} budget`,
      );
    }

    // Preserve any variant this run did not regenerate, so `--only` is not a
    // silent way to blank the other download.
    const existing = readFileSync(OUT, 'utf8');
    const previous = {};
    for (const key of ['human', 'bot']) {
      if (generated[key]) continue;
      const match = existing.match(
        new RegExp(
          `${key}:\\s*\\{[\\s\\S]*?base64:\\s*'([^']*)'[\\s\\S]*?bytes:\\s*(\\d+)[\\s\\S]*?pages:\\s*(\\d+)[\\s\\S]*?watermarkOffsets:\\s*\\[([^\\]]*)\\][\\s\\S]*?filename:\\s*'([^']*)'`,
        ),
      );
      if (!match) continue;
      previous[key] = {
        base64: match[1],
        bytes: Number(match[2]),
        pages: Number(match[3]),
        watermarkOffsets: match[4].trim()
          ? match[4].split(',').map((n) => Number(n.trim()))
          : [],
        filename: match[5],
      };
      log(
        `${key}: kept the previously generated copy (not regenerated this run)`,
      );
    }

    const all = { ...previous, ...generated };
    const fingerprint = resumeFingerprint();
    const stamp = new Date().toISOString().slice(0, 10);

    writeFileSync(OUT, renderModule(all, fingerprint, stamp));
    log(`wrote ${OUT}`);
    log(`fingerprint ${fingerprint}`);
    log(
      'commit the generated module; `nx test` fails if it drifts from the sources',
    );
  } finally {
    if (server && !server.killed) server.kill();
  }
}

/** The generated module's text. Kept in one place so its shape is reviewable. */
function renderModule(all, fingerprint, stamp) {
  const entry = (key) => {
    const v = all[key] ?? {
      base64: '',
      bytes: 0,
      pages: 0,
      watermarkOffsets: [],
      filename:
        key === 'human'
          ? 'Eddie-Freeman-Resume.pdf'
          : 'Eddie-Freeman-Resume-ATS.pdf',
    };
    return `  ${key}: {
    base64:
      '${v.base64}',
    bytes: ${v.bytes},
    pages: ${v.pages},
    watermarkOffsets: [${v.watermarkOffsets.join(', ')}],
    filename: '${v.filename}',
  },`;
  };

  return `/**
 * GENERATED by scripts/resume-pdf.mjs — do not edit. Rebuild with \`yarn resume:pdf\`.
 *
 * The two downloadable PDFs, base64-encoded into the Worker bundle so no PDF
 * exists at a public URL. Standard base64, not base64url: base64url's \`-\` can
 * form the \`sk-\` prefix that scripts/check-bundle-secrets.mjs looks for.
 *
 * \`watermarkOffsets\` are the byte offsets of the per-page placeholder run that
 * /api/resume/download overwrites with the requester's address. The run is a
 * fixed length, so patching preserves byte length and needs no reparse. See
 * util/resume/watermark.mjs for why that is the only affordable design here.
 *
 * Do not reformat: the base64 strings are single-quoted single lines on purpose.
 */

/**
 * @typedef {object} GeneratedPdf
 * @property {string} base64 Standard base64 (A-Z a-z 0-9 + /).
 * @property {number} bytes Decoded length. 0 means not generated.
 * @property {number} pages
 * @property {number[]} watermarkOffsets Byte offset of each placeholder run.
 * @property {string} filename Sent as the Content-Disposition filename.
 */

/** @type {Record<'human' | 'bot', GeneratedPdf>} */
export const RESUME_PDFS = {
${entry('human')}
${entry('bot')}
};

/**
 * Fingerprint of the sources these were generated from. See fingerprint.mjs.
 *
 * Annotated \`string\` deliberately: without it TypeScript narrows this to the
 * literal hash, and every \`=== ''\` check for "not generated yet" becomes a
 * compile error about types that cannot overlap. Same for the sizes below, which
 * is why RESUME_PDFS carries an explicit @type.
 *
 * @type {string}
 */
export const RESUME_DATA_HASH = '${fingerprint}';

/**
 * Generation date, used in the watermark line.
 * @type {string}
 */
export const GENERATED_AT = '${stamp}';
`;
}

main().catch((error) => {
  console.error('[resume-pdf]', error.message);
  process.exit(1);
});
