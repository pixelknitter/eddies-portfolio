/**
 * Obsidian → blog-collection conversion.
 *
 * Pure functions only: parsing and rewriting take strings in and give strings
 * out, so the whole conversion is unit-testable without touching a vault. The
 * CLI in scripts/obsidian-import.mjs handles the filesystem side.
 *
 * Plain ESM (typed with JSDoc) rather than TypeScript so the CLI can import it
 * with bare `node`, no build step or type-stripping flag.
 *
 * Obsidian syntax handled here:
 *   [[Note]] / [[Note|alias]]      wikilinks
 *   ![[image.png]] / ![[img|alt]]  embeds
 *   > [!note] Title                callouts
 *   #tag                           inline tags
 */

/**
 * Split YAML frontmatter from the body. Missing frontmatter is not an error.
 * @param {string} raw
 * @returns {{frontmatter: Record<string, unknown>, body: string}}
 */
export function parseFrontmatter(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { frontmatter: {}, body: raw.trim() };

  /** @type {Record<string, unknown>} */
  const frontmatter = {};
  // Deliberately minimal: Obsidian frontmatter is flat key/value plus simple
  // lists. Anything richer should be normalised by hand rather than guessed at.
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    const value = rawValue.trim();

    if (value === '') {
      frontmatter[key] = '';
    } else if (/^\[.*\]$/.test(value)) {
      frontmatter[key] = value
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else if (value === 'true' || value === 'false') {
      frontmatter[key] = value === 'true';
    } else {
      frontmatter[key] = value.replace(/^["']|["']$/g, '');
    }
  }

  return { frontmatter, body: raw.slice(match[0].length).trim() };
}

/**
 * Turn a note title or filename into a URL-safe slug.
 * @param {string} input
 * @returns {string}
 */
export function slugify(input) {
  return input
    .replace(/\.md$/i, '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Rewrite embeds `![[file.png]]` to markdown images.
 *
 * Runs before wikilink conversion — `![[…]]` starts with `[[` and would
 * otherwise be swallowed as a plain link.
 *
 * @param {string} body
 * @param {string} [assetPath]
 * @returns {string}
 */
export function convertEmbeds(body, assetPath = '/blog-assets') {
  return body.replace(/!\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_m, target, alt) => {
    const file = String(target).trim();
    const label = (alt ? String(alt) : file.replace(/\.[^.]+$/, '')).trim();
    return `![${label}](${assetPath}/${encodeURIComponent(file)})`;
  });
}

/**
 * Rewrite `[[Note]]` and `[[Note|alias]]` to markdown links.
 *
 * Targets not in `known` become plain text: a dangling link to a private vault
 * note would 404 for every reader, which is worse than losing the link.
 *
 * @param {string} body
 * @param {Set<string>} [known]
 * @param {string} [basePath]
 * @returns {string}
 */
export function convertWikilinks(body, known = new Set(), basePath = '/blog') {
  return body.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_m, target, alias) => {
    const name = String(target).trim();
    const label = (alias ? String(alias) : name).trim();
    const slug = slugify(name);
    return known.has(slug) ? `[${label}](${basePath}/${slug}/)` : label;
  });
}

/**
 * Convert Obsidian callouts to blockquotes with a bolded title.
 * @param {string} body
 * @returns {string}
 */
export function convertCallouts(body) {
  return body.replace(/^>\s*\[!([A-Za-z]+)\][-+]?\s*(.*)$/gm, (_m, kind, title) => {
    const heading =
      String(title).trim() ||
      String(kind).charAt(0).toUpperCase() + String(kind).slice(1).toLowerCase();
    return `> **${heading}**`;
  });
}

/**
 * Strip inline `#tag` markers, returning the cleaned body and the tags found.
 *
 * Skips fenced code blocks, markdown headings, and CSS hex colours.
 *
 * @param {string} body
 * @returns {{body: string, tags: string[]}}
 */
export function extractInlineTags(body) {
  /** @type {Set<string>} */
  const tags = new Set();
  const lines = body.split(/\r?\n/);
  let inFence = false;

  const cleaned = lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence || /^\s*#{1,6}\s/.test(line)) return line;

    return line.replace(/(^|\s)#([A-Za-z][A-Za-z0-9_/-]*)/g, (match, lead, tag) => {
      // A hex colour is hex-shaped *and* contains a digit — that keeps
      // `#FDEBF3` out of the tag list without swallowing words like `#cafe`.
      if (/^[0-9a-fA-F]{3,8}$/.test(tag) && /[0-9]/.test(tag)) {
        return match;
      }
      tags.add(String(tag).toLowerCase());
      // Drop only the marker; the word still reads as prose.
      return `${lead}${tag}`;
    });
  });

  return { body: cleaned.join('\n'), tags: [...tags] };
}

/**
 * Every vault asset an embed refers to, so the CLI knows what to copy.
 * @param {string} body
 * @returns {string[]}
 */
export function collectEmbeddedAssets(body) {
  /** @type {Set<string>} */
  const assets = new Set();
  for (const match of body.matchAll(/!\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g)) {
    assets.add(String(match[1]).trim());
  }
  return [...assets];
}

/**
 * Full conversion of one Obsidian note body.
 * @param {string} raw
 * @param {{knownSlugs?: Set<string>, assetPath?: string, basePath?: string}} [options]
 * @returns {{body: string, tags: string[], assets: string[], frontmatter: Record<string, unknown>}}
 */
export function convertNote(raw, options = {}) {
  const { frontmatter, body } = parseFrontmatter(raw);
  const assets = collectEmbeddedAssets(body);

  let out = convertEmbeds(body, options.assetPath);
  out = convertWikilinks(out, options.knownSlugs ?? new Set(), options.basePath);
  out = convertCallouts(out);

  const { body: tagless, tags: inlineTags } = extractInlineTags(out);

  const fmTags = Array.isArray(frontmatter.tags)
    ? frontmatter.tags.map((t) => String(t).toLowerCase())
    : typeof frontmatter.tags === 'string' && frontmatter.tags
      ? [String(frontmatter.tags).toLowerCase()]
      : [];

  return {
    body: tagless.replace(/\n{3,}/g, '\n\n').trim(),
    tags: [...new Set([...fmTags, ...inlineTags])],
    assets,
    frontmatter,
  };
}
