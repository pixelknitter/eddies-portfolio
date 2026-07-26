/**
 * Map a converted Obsidian note onto an Astro content-collection entry.
 *
 * Deliberately takes the target shape as options rather than hardcoding one
 * site's schema: this package is a candidate for upstreaming, and a mapper
 * that knows about `eddie-freeman` is useful to exactly one person.
 *
 * Pure and dependency-free — no filesystem, no YAML library — so the same
 * code runs in Node and in workerd.
 */

/** Fields Obsidian notes commonly use for the same concept. */
const ALIASES = {
  blurb: ['blurb', 'description', 'summary', 'excerpt'],
  hero: ['hero', 'heroImage', 'cover', 'image', 'banner'],
};

function firstDefined(frontmatter, keys) {
  for (const key of keys) {
    const value = frontmatter[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

/**
 * The first real paragraph, used as a fallback summary.
 * @param {string} body
 */
export function firstParagraph(body) {
  return body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .find(
      (block) =>
        block &&
        !block.startsWith('#') &&
        !block.startsWith('!') &&
        !block.startsWith('>') &&
        !block.startsWith('```')
    );
}

/**
 * Derive the entry's title: explicit frontmatter, else the first H1, else the
 * filename.
 *
 * @param {{frontmatter: Record<string, unknown>, body: string, filename?: string}} input
 */
export function deriveTitle({ frontmatter, body, filename = '' }) {
  const heading = /^#\s+(.+)$/m.exec(body)?.[1];
  return String(
    frontmatter.title || heading || filename.replace(/\.md$/i, '')
  ).trim();
}

/**
 * Build content-collection frontmatter from a converted note.
 *
 * @param {{body: string, tags: string[], frontmatter: Record<string, unknown>}} converted
 *   Output of `convertNote`.
 * @param {object} [options]
 * @param {string} [options.filename]      Source filename, for title fallback.
 * @param {Record<string, unknown>} [options.defaults]
 *   Values applied when the note does not supply them. This is where a site
 *   puts its required fields — e.g. `{ author: 'someone', relatedPosts: [] }`.
 *   Required-but-absent fields are the usual cause of a schema failure.
 * @param {string} [options.assetPath]     Prefix for a hero image copied out
 *   of the vault. Defaults to `/blog-assets`.
 * @param {number} [options.blurbLength]   Max length of a derived blurb.
 * @param {boolean} [options.publish]      `false` (default) marks it a draft.
 * @returns {{frontmatter: Record<string, unknown>, body: string, heroAsset?: string}}
 */
export function toEntry(converted, options = {}) {
  const {
    filename = '',
    defaults = {},
    assetPath = '/blog-assets',
    blurbLength = 200,
    publish = false,
  } = options;

  const { body, tags, frontmatter } = converted;

  const title = deriveTitle({ frontmatter, body, filename });

  const summary = firstDefined(frontmatter, ALIASES.blurb);
  const derived = firstParagraph(body);
  const blurb = String(
    summary ?? (derived ? derived.replace(/\s+/g, ' ').slice(0, blurbLength) : title)
  ).trim();

  // Hero images are referenced by filename in a vault; the caller copies the
  // file and we record where it will live.
  const hero = firstDefined(frontmatter, ALIASES.hero);
  const heroAsset = hero ? String(hero).split('/').pop() : undefined;

  const mapped = {
    ...defaults,
    title,
    blurb,
    tags,
    draft: !publish,
  };

  if (heroAsset) {
    mapped.heroImage = { url: `${assetPath}/${heroAsset}`, alt: title };
  }

  // A leading H1 duplicates the title the layout renders from frontmatter.
  const withoutTitleHeading = body.replace(/^#\s+.+\n+/, '');

  return { frontmatter: mapped, body: withoutTitleHeading, heroAsset };
}

/**
 * Serialise frontmatter to YAML.
 *
 * Handles only the shapes this mapper produces — strings, booleans, arrays of
 * strings, and one level of nesting — rather than pulling in a YAML library
 * and its bundle cost. Anything richer should be written by the caller.
 *
 * @param {Record<string, unknown>} frontmatter
 * @returns {string}
 */
export function serialiseFrontmatter(frontmatter) {
  const lines = ['---'];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => JSON.stringify(String(v))).join(', ')}]`);
    } else if (value && typeof value === 'object') {
      lines.push(`${key}:`);
      for (const [k, v] of Object.entries(value)) {
        lines.push(`  ${k}: ${JSON.stringify(String(v))}`);
      }
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(String(value))}`);
    }
  }

  lines.push('---', '');
  return lines.join('\n');
}
