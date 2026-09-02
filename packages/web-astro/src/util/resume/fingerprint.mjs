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
  // The registry decides which slugs are printable and what each generated file
  // is called, so a change here changes the artifacts even when no prose moved.
  'util/resume/variants.mjs',
  // The assembly rules, including how a variant's emphasis overrides apply. A
  // change here can reselect which bullets reach paper without touching a
  // single word of content.
  'util/resume/assemble.ts',
  'components/resume/ResumeVisual.astro',
  'components/resume/ResumeFull.astro',
  'components/resume/ResumeSection.astro',
  'components/resume/ResumeSkills.astro',
  'components/resume/ResumeSpeaking.astro',
  'components/resume/PrintContact.astro',
  'layouts/PrintLayout.astro',
  'styles/print.css',
  'styles/resume-organic.css',
  'pages/cv/print/[variant]/human.astro',
  'pages/cv/print/[variant]/bot.astro',
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

/**
 * A hash of the sealed resume *content* the PDFs were rendered from.
 *
 * ## The gap this closes
 *
 * `FINGERPRINTED_FILES` covers the code and styling that shape a PDF, and
 * deliberately not `src/content/resume` — which is where the prose actually
 * lives. So editing the resume, resealing, and forgetting to regenerate left
 * `resumeFingerprint()` byte-identical and `pdfs.spec.ts` green, while the
 * committed downloads described the old claims. That is not hypothetical: a
 * content pass moved the PDF payload 22KB with the fingerprint unchanged.
 *
 * ## Why this takes its input instead of reading the vault
 *
 * The blobs cannot be hashed directly. `sealFile` draws a fresh random IV per
 * seal, so identical prose re-encrypts to different bytes — a ciphertext hash
 * would churn on every reseal and mean nothing. The plaintext is the only
 * stable thing to hash, and reaching it needs the key.
 *
 * Keeping the key out of here is what leaves this function pure, testable
 * without a vault, and safe for `pdfs.spec.ts` to import. The caller that
 * *does* hold the key (`seal-content.mjs resume-drift`) supplies the entries.
 *
 * ## Why a key-gated check is the right strength
 *
 * It cannot run in CI, and does not need to: sealed content cannot be edited
 * without the key, so no keyless contributor can cause this drift. The guard
 * belongs where the capability is.
 *
 * @param {Array<{path: string, content: string}>} entries
 * @returns {string} `sha256:<hex>`, or `''` for an empty set.
 */
export function contentFingerprint(entries) {
  // Distinguishable from a real digest on purpose. A keyless checkout
  // materializes nothing, and "no content" must not be mistakable for
  // "content that happens to hash to this".
  if (entries.length === 0) return '';

  const hash = createHash('sha256');
  // Vault order is directory order — neither sorted nor stable across machines.
  // Sorting here is what stops the guard failing on a colleague's checkout.
  for (const { path, content } of [...entries].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  )) {
    // Same NUL discipline as above, and for a sharper reason: without it
    // {path:'a', content:'bc'} and {path:'ab', content:'c'} collide.
    hash.update(path);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}
