import { describe, it, expect } from 'vitest';
import {
  isPublished,
  isScheduled,
  publishedPosts,
  scheduledPosts,
} from './posts.mjs';

const NOW = new Date('2026-07-26T12:00:00Z');
const past = '2026-07-01T09:00:00Z';
const future = '2026-08-01T09:00:00Z';

const entry = (data: Record<string, unknown>) => ({ id: 'x', data });

describe('isPublished', () => {
  it('publishes an undated, non-draft post immediately', () => {
    expect(isPublished({}, NOW)).toBe(true);
  });

  it('publishes once the date has passed', () => {
    expect(isPublished({ publishDate: past }, NOW)).toBe(true);
  });

  it('withholds a post dated in the future', () => {
    expect(isPublished({ publishDate: future }, NOW)).toBe(false);
  });

  it('publishes exactly at the boundary', () => {
    expect(isPublished({ publishDate: NOW.toISOString() }, NOW)).toBe(true);
  });

  it('keeps drafts hidden regardless of date', () => {
    expect(isPublished({ draft: true }, NOW)).toBe(false);
    expect(isPublished({ draft: true, publishDate: past }, NOW)).toBe(false);
  });

  it('accepts a Date as well as a string', () => {
    expect(isPublished({ publishDate: new Date(past) }, NOW)).toBe(true);
    expect(isPublished({ publishDate: new Date(future) }, NOW)).toBe(false);
  });
});

describe('isScheduled', () => {
  it('is true only for a dated, future, non-draft post', () => {
    expect(isScheduled({ publishDate: future }, NOW)).toBe(true);
  });

  it('is false once live, undated, or a draft', () => {
    expect(isScheduled({ publishDate: past }, NOW)).toBe(false);
    expect(isScheduled({}, NOW)).toBe(false);
    expect(isScheduled({ draft: true, publishDate: future }, NOW)).toBe(false);
  });
});

describe('publishedPosts', () => {
  const entries = [
    entry({ publishDate: '2026-07-01T00:00:00Z' }),
    entry({ publishDate: future }),
    entry({ publishDate: '2026-07-20T00:00:00Z' }),
    entry({ draft: true, publishDate: past }),
    entry({}),
  ];

  it('excludes future-dated posts and drafts', () => {
    expect(publishedPosts(entries, NOW)).toHaveLength(3);
  });

  it('orders newest first', () => {
    const dates = publishedPosts(entries, NOW).map((e) => e.data.publishDate ?? null);
    expect(dates[0]).toBe('2026-07-20T00:00:00Z');
    expect(dates[1]).toBe('2026-07-01T00:00:00Z');
    // The undated post sorts last rather than being dropped.
    expect(dates[2]).toBe(null);
  });
});

describe('scheduledPosts', () => {
  it('lists only future posts, soonest first', () => {
    const entries = [
      entry({ publishDate: '2026-09-01T00:00:00Z' }),
      entry({ publishDate: '2026-08-01T00:00:00Z' }),
      entry({ publishDate: past }),
      entry({ draft: true, publishDate: '2026-08-15T00:00:00Z' }),
    ];

    const queue = scheduledPosts(entries, NOW);
    expect(queue).toHaveLength(2);
    expect(queue[0].data.publishDate).toBe('2026-08-01T00:00:00Z');
    expect(queue[1].data.publishDate).toBe('2026-09-01T00:00:00Z');
  });
});
