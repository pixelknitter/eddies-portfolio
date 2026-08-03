import { describe, it, expect } from 'vitest';
import { buildCorpus } from './corpus.mjs';

/**
 * Entries as `getCollection` hands them over: `{ id, data, body }`.
 */
const entry = (id: string, data: Record<string, unknown>, body = '') => ({
  id,
  data,
  body,
});

const PAST = new Date('2026-01-01T00:00:00Z');
const FUTURE = new Date('2099-01-01T00:00:00Z');
const NOW = new Date('2026-06-01T00:00:00Z');

describe('buildCorpus', () => {
  it('offers a published blog post as content, namespaced by collection', () => {
    const corpus = buildCorpus(
      {
        blog: [
          entry(
            'shipping-fast',
            { title: 'Shipping Fast', draft: false, publishDate: PAST },
            'The post body.',
          ),
        ],
      },
      { now: NOW },
    );

    expect(corpus).toEqual([
      expect.objectContaining({
        id: 'blog/shipping-fast',
        content: 'The post body.',
      }),
    ]);
  });

  it('withholds a scheduled post until its publishDate has passed', () => {
    const blog = [
      entry('future', { title: 'Not Yet', draft: false, publishDate: FUTURE }),
    ];

    expect(buildCorpus({ blog }, { now: NOW })).toEqual([]);
  });

  it('withholds a draft blog post', () => {
    const blog = [entry('wip', { title: 'Work In Progress', draft: true })];

    expect(buildCorpus({ blog }, { now: NOW })).toEqual([]);
  });

  it('reveals drafts and scheduled posts on the review tiers', () => {
    const blog = [
      entry('wip', { title: 'Work In Progress', draft: true }),
      entry('future', { title: 'Not Yet', draft: false, publishDate: FUTURE }),
    ];

    expect(buildCorpus({ blog }, { reveal: true, now: NOW })).toHaveLength(2);
  });

  it('keeps a STAR body as constraints, never as content', () => {
    const star = [
      entry('migration', { title: 'Migration', draft: false }, 'Never claim X.'),
    ];

    const [selected] = buildCorpus({ star }, { now: NOW });

    expect(selected.constraints).toBe('Never claim X.');
    expect(selected.content).toBeUndefined();
  });

  it('exposes a project description as summary so retrieval can index it', () => {
    const projects = [
      entry('portfolio', {
        title: 'Portfolio',
        description: 'A Workers deployment pipeline with smoke tests.',
      }),
    ];

    const [selected] = buildCorpus({ projects }, { now: NOW });

    expect(selected.data.summary).toBe(
      'A Workers deployment pipeline with smoke tests.',
    );
  });

  it('exposes a blog blurb as summary so retrieval can index it', () => {
    const blog = [
      entry('post', {
        title: 'A Post',
        blurb: 'Why smoke tests beat status checks.',
        draft: false,
      }),
    ];

    const [selected] = buildCorpus({ blog }, { now: NOW });

    expect(selected.data.summary).toBe('Why smoke tests beat status checks.');
  });

  it('withholds a draft project', () => {
    const projects = [entry('wip', { title: 'Unfinished', draft: true })];

    expect(buildCorpus({ projects }, { now: NOW })).toEqual([]);
  });
});

describe('a corpus entry built from a project', () => {
  it('is retrievable by a technology named in its tags', async () => {
    const { selectContext } = await import('./retrieval.mjs');

    const corpus = buildCorpus({
      projects: [
        entry('portfolio', {
          title: 'Portfolio',
          description: 'A personal site.',
          tags: ['astro', 'cloudflare-workers'],
          stack: ['Astro', 'TypeScript'],
        }),
      ],
    });

    expect(selectContext('what has he built with astro', corpus)).toHaveLength(
      1,
    );
  });

  it('is retrievable by wording that appears only in its description', async () => {
    const { selectContext } = await import('./retrieval.mjs');

    const corpus = buildCorpus({
      projects: [
        entry('portfolio', {
          title: 'Portfolio',
          description: 'Deployments verified by smoke tests before promotion.',
          tags: [],
        }),
      ],
    });

    expect(selectContext('does he use smoke tests', corpus)).toHaveLength(1);
  });
});
