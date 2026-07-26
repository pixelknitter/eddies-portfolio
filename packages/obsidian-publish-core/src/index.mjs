/**
 * Obsidian → Astro content-collection conversion.
 *
 * Two layers, deliberately separate:
 *   convert.mjs     generic Obsidian syntax handling — reusable by any site
 *   frontmatter.mjs mapping onto a target schema, configured by the caller
 *
 * Both are pure and dependency-free, so the same code runs in a CLI, in a
 * Cloudflare Worker, and in an Obsidian plugin.
 */
export {
  parseFrontmatter,
  slugify,
  convertEmbeds,
  convertWikilinks,
  convertCallouts,
  extractInlineTags,
  collectEmbeddedAssets,
  convertNote,
} from './convert.mjs';

export {
  firstParagraph,
  deriveTitle,
  toEntry,
  serialiseFrontmatter,
} from './frontmatter.mjs';
