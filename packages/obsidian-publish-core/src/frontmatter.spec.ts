import { describe, it, expect } from 'vitest';
import { convertNote } from './convert.mjs';
import {
  firstParagraph,
  deriveTitle,
  toEntry,
  serialiseFrontmatter,
} from './frontmatter.mjs';

const note = (extra = '') =>
  ['---', 'title: A Real Title', 'cover: shot.png', '---', '# A Real Title', '', 'The opening paragraph.', extra]
    .join('\n');

describe('firstParagraph', () => {
  it('skips headings, embeds, quotes and code fences', () => {
    const body = ['# Heading', '', '> a quote', '', '![x](y.png)', '', '```js', 'code', '```', '', 'Real prose here.'].join('\n');
    expect(firstParagraph(body)).toBe('Real prose here.');
  });
});

describe('deriveTitle', () => {
  it('prefers explicit frontmatter', () => {
    expect(deriveTitle({ frontmatter: { title: 'From Matter' }, body: '# From Heading' })).toBe('From Matter');
  });

  it('falls back to the first heading, then the filename', () => {
    expect(deriveTitle({ frontmatter: {}, body: '# From Heading' })).toBe('From Heading');
    expect(deriveTitle({ frontmatter: {}, body: 'no heading', filename: 'my-note.md' })).toBe('my-note');
  });
});

describe('toEntry', () => {
  const converted = convertNote(note());

  it('applies caller-supplied defaults for required schema fields', () => {
    // Required-but-absent fields are the usual cause of a schema failure.
    const { frontmatter } = toEntry(converted, {
      defaults: { author: 'someone', relatedPosts: [] },
    });
    expect(frontmatter.author).toBe('someone');
    expect(frontmatter.relatedPosts).toEqual([]);
  });

  it('hardcodes no site-specific values', () => {
    const { frontmatter } = toEntry(converted);
    expect(JSON.stringify(frontmatter)).not.toContain('eddie');
  });

  it('derives a blurb from the first paragraph when none is given', () => {
    expect(toEntry(converted).frontmatter.blurb).toBe('The opening paragraph.');
  });

  it('prefers an explicit summary under any of its aliases', () => {
    for (const key of ['blurb', 'description', 'summary', 'excerpt']) {
      const c = convertNote(['---', 'title: T', `${key}: Chosen`, '---', 'Body text.'].join('\n'));
      expect(toEntry(c).frontmatter.blurb, key).toBe('Chosen');
    }
  });

  it('passes domain through when the note declares it, and omits it otherwise', () => {
    const withDomain = convertNote(['---', 'title: T', 'domain: Agentic systems', '---', 'Body.'].join('\n'));
    expect(toEntry(withDomain).frontmatter.domain).toBe('Agentic systems');
    expect('domain' in toEntry(converted).frontmatter).toBe(false);
  });

  it('passes related through verbatim, and omits it when absent', () => {
    const withRelated = convertNote(
      ['---', 'title: T', 'related:', '  - projects/knotty-brain', '  - blog/hello', '---', 'Body.'].join('\n'),
    );
    expect(toEntry(withRelated).frontmatter.related).toEqual(['projects/knotty-brain', 'blog/hello']);
    expect('related' in toEntry(converted).frontmatter).toBe(false);
  });

  it('maps a hero image onto a nested object and reports the asset to copy', () => {
    const result = toEntry(converted);
    expect(result.heroAsset).toBe('shot.png');
    expect(result.frontmatter.heroImage).toEqual({
      url: '/blog-assets/shot.png',
      alt: 'A Real Title',
    });
  });

  it('defaults to a draft unless publishing is requested', () => {
    expect(toEntry(converted).frontmatter.draft).toBe(true);
    expect(toEntry(converted, { publish: true }).frontmatter.draft).toBe(false);
  });

  it('drops the leading H1 that duplicates the title', () => {
    expect(toEntry(converted).body).not.toMatch(/^#\s+A Real Title/);
    expect(toEntry(converted).body).toContain('The opening paragraph.');
  });
});

describe('serialiseFrontmatter', () => {
  it('writes scalars, booleans, arrays and one level of nesting', () => {
    const yaml = serialiseFrontmatter({
      title: 'A "quoted" title',
      draft: false,
      tags: ['one', 'two'],
      heroImage: { url: '/x.png', alt: 'Alt' },
      relatedPosts: [],
    });
    expect(yaml).toContain('title: "A \\"quoted\\" title"');
    expect(yaml).toContain('draft: false');
    expect(yaml).toContain('tags: ["one", "two"]');
    expect(yaml).toContain('heroImage:\n  url: "/x.png"\n  alt: "Alt"');
    expect(yaml).toContain('relatedPosts: []');
    expect(yaml.startsWith('---\n')).toBe(true);
    expect(yaml.trimEnd().endsWith('---')).toBe(true);
  });

  it('omits undefined values', () => {
    expect(serialiseFrontmatter({ a: 'x', b: undefined })).not.toContain('b:');
  });
});
