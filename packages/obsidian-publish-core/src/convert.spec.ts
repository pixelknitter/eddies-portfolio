import { describe, it, expect } from 'vitest';
import {
  parseFrontmatter,
  slugify,
  convertEmbeds,
  convertWikilinks,
  convertCallouts,
  extractInlineTags,
  collectEmbeddedAssets,
  convertNote,
} from './convert.mjs';

describe('parseFrontmatter', () => {
  it('returns the whole document as body when there is no frontmatter', () => {
    const { frontmatter, body } = parseFrontmatter('# Title\n\nsome prose');
    expect(frontmatter).toEqual({});
    expect(body).toBe('# Title\n\nsome prose');
  });

  it('parses scalars, booleans and inline lists', () => {
    const { frontmatter } = parseFrontmatter(
      ['---', 'title: A Post', 'draft: true', 'tags: [one, "two"]', '---', 'body'].join('\n')
    );
    expect(frontmatter.title).toBe('A Post');
    expect(frontmatter.draft).toBe(true);
    expect(frontmatter.tags).toEqual(['one', 'two']);
  });

  it('does not treat body content as frontmatter', () => {
    const { body } = parseFrontmatter('---\ntitle: X\n---\nnot: frontmatter');
    expect(body).toBe('not: frontmatter');
  });
});

describe('slugify', () => {
  it.each([
    ['My First Post', 'my-first-post'],
    ['My First Post.md', 'my-first-post'],
    ['Héllo Wörld', 'hello-world'],
    ['  spaced  out  ', 'spaced-out'],
    ['Symbols & Things!', 'symbols-things'],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

describe('convertEmbeds', () => {
  it('rewrites an embed to a markdown image', () => {
    expect(convertEmbeds('![[diagram.png]]')).toBe(
      '![diagram](/blog-assets/diagram.png)'
    );
  });

  it('uses the alias as alt text', () => {
    expect(convertEmbeds('![[diagram.png|Architecture]]')).toBe(
      '![Architecture](/blog-assets/diagram.png)'
    );
  });

  it('encodes filenames containing spaces', () => {
    expect(convertEmbeds('![[my file.png]]')).toContain('/blog-assets/my%20file.png');
  });
});

describe('convertWikilinks', () => {
  it('links targets that exist in the collection', () => {
    expect(convertWikilinks('see [[Hello]]', new Set(['hello']))).toBe(
      'see [Hello](/blog/hello/)'
    );
  });

  it('honours the alias for the link text', () => {
    expect(convertWikilinks('see [[Hello|this post]]', new Set(['hello']))).toBe(
      'see [this post](/blog/hello/)'
    );
  });

  it('degrades unknown targets to plain text rather than dangling links', () => {
    expect(convertWikilinks('see [[Private Note]]', new Set())).toBe('see Private Note');
    expect(convertWikilinks('see [[Private|notes]]', new Set())).toBe('see notes');
  });
});

describe('convertCallouts', () => {
  it('keeps the callout title', () => {
    expect(convertCallouts('> [!warning] Watch out')).toBe('> **Watch out**');
  });

  it('falls back to the callout type when untitled', () => {
    expect(convertCallouts('> [!note]')).toBe('> **Note**');
  });

  it('handles foldable callout markers', () => {
    expect(convertCallouts('> [!tip]- Collapsed')).toBe('> **Collapsed**');
  });
});

describe('extractInlineTags', () => {
  it('pulls tags out of prose and removes the marker', () => {
    const { body, tags } = extractInlineTags('a post about #astro and #cloudflare');
    expect(tags).toEqual(['astro', 'cloudflare']);
    expect(body).toBe('a post about astro and cloudflare');
  });

  it('ignores markdown headings', () => {
    const { tags, body } = extractInlineTags('## Heading\ntext');
    expect(tags).toEqual([]);
    expect(body).toBe('## Heading\ntext');
  });

  it('ignores anything inside fenced code blocks', () => {
    const src = ['```bash', '# a shell comment', 'echo #notatag', '```'].join('\n');
    const { tags, body } = extractInlineTags(src);
    expect(tags).toEqual([]);
    expect(body).toBe(src);
  });

  it('leaves hex colours alone', () => {
    const { tags } = extractInlineTags('the colour #FDEBF3 reads well');
    expect(tags).toEqual([]);
  });
});

describe('collectEmbeddedAssets', () => {
  it('lists each embedded file once', () => {
    const assets = collectEmbeddedAssets('![[a.png]] ![[b.png|alt]] ![[a.png]]');
    expect(assets).toEqual(['a.png', 'b.png']);
  });
});

describe('convertNote', () => {
  const raw = [
    '---',
    'title: Building in the Between',
    'tags: [astro]',
    '---',
    '# Heading',
    '',
    'Some prose about #cloudflare and [[Hello]] and [[Missing Note]].',
    '',
    '![[diagram.png|A diagram]]',
    '',
    '> [!note] Worth knowing',
  ].join('\n');

  const result = convertNote(raw, { knownSlugs: new Set(['hello']) });

  it('keeps frontmatter available to the caller', () => {
    expect(result.frontmatter.title).toBe('Building in the Between');
  });

  it('merges frontmatter and inline tags without duplicates', () => {
    expect(result.tags.sort()).toEqual(['astro', 'cloudflare']);
  });

  it('reports embedded assets for copying', () => {
    expect(result.assets).toEqual(['diagram.png']);
  });

  it('rewrites embeds, known links, callouts and strips tag markers', () => {
    expect(result.body).toContain('![A diagram](/blog-assets/diagram.png)');
    expect(result.body).toContain('[Hello](/blog/hello/)');
    expect(result.body).toContain('> **Worth knowing**');
    expect(result.body).toContain('about cloudflare');
    expect(result.body).not.toContain('#cloudflare');
  });

  it('drops links to notes that are not published', () => {
    expect(result.body).toContain('Missing Note');
    expect(result.body).not.toContain('[[Missing Note]]');
    expect(result.body).not.toContain('/blog/missing-note/');
  });
});
