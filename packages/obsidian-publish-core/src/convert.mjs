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
  //
  // A list may still arrive on the lines *after* its key, in two shapes: a
  // YAML block list (`- item`), and a flow array wrapped across lines, which
  // is what Prettier turns a long `tags: [...]` into. Reading only the key's
  // own line yielded an empty value for both and silently dropped every item —
  // and a silently empty `tags` costs retrieval scoring rather than failing.
  const lines = match[1].split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    let value = rawValue.trim();

    if (value === '' || (value.startsWith('[') && !value.endsWith(']'))) {
      const gathered = [];
      let cursor = index + 1;

      // Consume indented continuation lines. An unindented line is the next
      // key, so the list ends there whether or not it was closed as expected.
      while (cursor < lines.length && /^\s+\S/.test(lines[cursor])) {
        gathered.push(lines[cursor].trim());
        cursor += 1;
      }

      if (gathered.length > 0) {
        const joined = gathered.join(' ');
        const isBlockList = gathered.every((item) => item.startsWith('- '));

        if (isBlockList) {
          frontmatter[key] = gathered
            .map((item) => item.slice(2).trim().replace(/^["']|["']$/g, ''))
            .filter(Boolean);
          index = cursor - 1;
          continue;
        }

        // A wrapped flow array: re-join and fall through to the inline branch.
        if (value.startsWith('[') || joined.startsWith('[')) {
          value = `${value}${joined}`.replace(/,\s*\]$/, ']');
          index = cursor - 1;
        }
      }
    }

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

  /**
   * A line that is nothing but tags is metadata the author put at the bottom
   * of a note, not prose. Stripping only the `#` from it leaves a stray line
   * like `astro cloudflare testing deployment` at the end of the published
   * post — which is exactly what shipped in the first real conversion.
   *
   * Mid-sentence tags still keep their word: `I love #astro` should read as
   * `I love astro`, not lose the noun.
   */
  const isTagOnlyLine = (line) =>
    /^\s*(#[A-Za-z][A-Za-z0-9_/-]*\s*)+$/.test(line);

  const cleaned = lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence || /^\s*#{1,6}\s/.test(line)) return line;

    if (isTagOnlyLine(line)) {
      for (const [, tag] of line.matchAll(/#([A-Za-z][A-Za-z0-9_/-]*)/g)) {
        tags.add(String(tag).toLowerCase());
      }
      return null;
    }

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

  // Drop removed lines, then collapse the blank run they leave behind so a
  // trailing tag block does not become trailing whitespace.
  const cleanedBody = cleaned
    .filter((line) => line !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/, '\n');

  return { body: cleanedBody, tags: [...tags] };
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
