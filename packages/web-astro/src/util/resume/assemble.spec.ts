import { describe, it, expect } from 'vitest';

import { assembleVariant } from './assemble';

/**
 * The loader's variant resolution, tested against hand-built entries rather
 * than the content collection: `getCollection` needs an Astro runtime, and the
 * rules worth asserting here are about which entry wins, not about globbing.
 *
 * The question every one of these asks is the one the content model was chosen
 * for: where does a correction land? A fact edited once must reach every
 * variant; a framing edited once must reach exactly one.
 */

type Entry = { id: string; data: Record<string, unknown>; body?: string };

const profile = (variant?: string): Entry => ({
  id: `profile/${variant ?? 'default'}`,
  data: {
    section: 'profile',
    variant,
    title: `Eddie Freeman — ${variant ?? 'default'}`,
    headline: `${variant ?? 'default'} headline`,
    pitch: `${variant ?? 'default'} pitch`,
    location: 'Portland, OR',
    summary: `${variant ?? 'default'} summary`,
    stats: [],
    tags: [],
    order: 50,
    ...(variant === 'solutions'
      ? {
          sectionOrder: [
            'strengths',
            'experience',
            'speaking',
            'skills',
            'education',
          ],
        }
      : {}),
  },
  body: 'long summary',
});

const strengths = (variant?: string): Entry => ({
  id: `strengths/${variant ?? 'default'}`,
  data: {
    section: 'strengths',
    variant,
    title: 'strengths',
    order: 50,
    tags: [],
    items: [
      {
        title: `${variant ?? 'default'} strength`,
        detail: 'detail',
        wide: false,
      },
    ],
  },
});

const skills = (variant?: string): Entry => ({
  id: `skills/${variant ?? 'default'}`,
  data: {
    section: 'skills',
    variant,
    title: 'skills',
    order: 50,
    tags: [],
    groups: [
      {
        group: `${variant ?? 'default'} group`,
        tone: 'accent',
        items: ['TypeScript'],
      },
    ],
  },
});

const speaking: Entry = {
  id: 'speaking/speaking',
  data: {
    section: 'speaking',
    title: 'speaking',
    order: 50,
    tags: [],
    evaluation: 'evaluation',
    talks: [],
  },
};

const education: Entry = {
  id: 'education/education',
  data: {
    section: 'education',
    title: 'education',
    order: 50,
    tags: [],
    entries: [{ period: '2004', institution: 'Somewhere', detail: 'detail' }],
  },
};

const role: Entry = {
  id: 'experience/current',
  data: {
    section: 'experience',
    title: 'current',
    order: 10,
    tags: [],
    org: 'Wandering Hearth',
    role: 'Founder',
    location: 'Portland, OR',
    dates: 'Feb 2023 – Present',
    start: '2023-02',
    tier: 'selected',
    chips: [],
    highlights: [],
    lede: 'base lede',
    summary: 'base summary',
    featured: [0],
    variants: {
      solutions: { featured: [1], summary: 'solutions summary' },
    },
  },
  body: '- first bullet\n- second bullet\n',
};

const base = [profile(), strengths(), skills(), speaking, education, role];

/* eslint-disable @typescript-eslint/no-explicit-any */
const assemble = (entries: Entry[], variant?: string) =>
  assembleVariant(entries as any, variant);
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('assembleVariant', () => {
  it('uses the default sections when no variant is asked for', () => {
    const resume = assemble(base, 'product');
    expect(resume.variant).toBe('product');
    expect(resume.headline).toBe('default headline');
    expect(resume.strengths[0].title).toBe('default strength');
  });

  it('prefers a variant-specific singleton over the default', () => {
    const entries = [...base, profile('solutions'), strengths('solutions')];
    const resume = assemble(entries, 'solutions');
    expect(resume.headline).toBe('solutions headline');
    expect(resume.strengths[0].title).toBe('solutions strength');
  });

  // The fallback is what lets a variant override only what it reframes. Version
  // C rewrites three sections and leaves two alone; duplicating the two it did
  // not touch would put the same facts in two files and let them drift.
  it('falls back to the default for a section the variant does not override', () => {
    const entries = [...base, profile('solutions')];
    const resume = assemble(entries, 'solutions');
    expect(resume.skills[0].group).toBe('default group');
  });

  it('carries the variant section order through', () => {
    const entries = [...base, profile('solutions')];
    expect(assemble(entries, 'solutions').sectionOrder).toEqual([
      'strengths',
      'experience',
      'speaking',
      'skills',
      'education',
    ]);
    expect(assemble(base, 'product').sectionOrder).toBeUndefined();
  });

  it('applies a role emphasis override without changing the bullets', () => {
    const entries = [...base, profile('solutions')];
    const current = assemble(entries, 'solutions').now;

    expect(current.summary).toBe('solutions summary');
    // The lede was not overridden, so the base one stands.
    expect(current.lede).toBe('base lede');
    // Same facts, different spotlight.
    expect(current.bullets.map((b) => b.text)).toEqual([
      'first bullet',
      'second bullet',
    ]);
    expect(current.bullets[0].featured).toBeUndefined();
    expect(current.bullets[1].featured).toBe(true);
  });

  it('leaves the default variant untouched by another variant override', () => {
    const resume = assemble(base, 'product');
    expect(resume.now.summary).toBe('base summary');
    expect(resume.now.bullets[0].featured).toBe(true);
    expect(resume.now.bullets[1].featured).toBeUndefined();
  });

  // An index past the end silently drops emphasis, which is exactly the drift
  // indices are vulnerable to when bullets are edited under a variant.
  it('rejects an override that spotlights a bullet that does not exist', () => {
    const broken: Entry = {
      ...role,
      data: { ...role.data, variants: { solutions: { featured: [7] } } },
    };
    const entries = [
      profile(),
      strengths(),
      skills(),
      speaking,
      education,
      broken,
    ];
    expect(() => assemble(entries, 'solutions')).toThrow(/featured index 7/);
  });

  it('still names the section that is missing', () => {
    const entries = [profile(), strengths(), skills(), speaking, role];
    expect(() => assemble(entries, 'product')).toThrow(/education/);
  });
});
