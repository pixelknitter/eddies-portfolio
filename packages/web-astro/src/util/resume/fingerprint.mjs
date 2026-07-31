import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A hash of everything that shapes the generated PDFs.
 *
 * The PDFs are build artifacts committed into the repo, so the failure to guard
 * against is editing the resume and forgetting to regenerate — leaving a download
 * that silently disagrees with the site. A spec compares this against the hash
 * recorded in `pdfs.generated.mjs` and tells you to run `yarn resume:pdf`.
 *
 * ## Why the inputs are hashed and not the output
 *
 * Chrome stamps `/CreationDate`, `/ModDate` and a trailer `/ID` into every PDF it
 * prints, so two runs over identical input produce different bytes. Hashing the
 * output would mean the committed base64 churned on every regeneration and the
 * check could never distinguish "content changed" from "generated again".
 *
 * ## Why source text and not the parsed data
 *
 * Reading `RESUME` would need a TypeScript loader, and this module has to run from
 * a plain node script as well as from vitest. Hashing file *text* also catches
 * more: a change to the print stylesheet or the print layout alters the PDF just
 * as surely as a change to a bullet, and a data-only hash would miss it — which is
 * the likelier drift of the two.
 *
 * The cost is that reformatting a file invalidates the hash without changing the
 * document. Prettier is deterministic and runs in CI, so in practice that means
 * one regeneration after a formatting sweep, which is cheap and visible.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
/** packages/web-astro/src */
const SRC = resolve(HERE, '..', '..');

/**
 * Every file whose content affects the rendered PDFs.
 *
 * Deliberately an explicit list rather than a glob: a glob over `src/util/resume`
 * would sweep in the generated module and the specs, and hashing the generated
 * module into its own expected hash cannot converge.
 */
export const FINGERPRINTED_FILES = [
  'util/resume/resume.data.ts',
  'util/resume/markup.ts',
  'util/resume/watermark.mjs',
  'components/resume/ResumeVisual.astro',
  'components/resume/ResumeFull.astro',
  'components/resume/ResumeSection.astro',
  'components/resume/PrintContact.astro',
  'layouts/PrintLayout.astro',
  'styles/print.css',
  'styles/resume-organic.css',
  'pages/cv/print/human.astro',
  'pages/cv/print/bot.astro',
];

/**
 * @param {string} [srcDir] Override for tests.
 * @returns {string} `sha256:<hex>`
 */
export function resumeFingerprint(srcDir = SRC) {
  const hash = createHash('sha256');
  for (const relative of FINGERPRINTED_FILES) {
    // The path goes into the hash too, so moving a file is a change even when its
    // bytes are identical.
    hash.update(relative);
    hash.update('\0');
    hash.update(readFileSync(join(srcDir, relative)));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}
