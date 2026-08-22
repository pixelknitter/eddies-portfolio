import { DEFAULT_VARIANT } from './variants.mjs';

import type { CollectionEntry } from 'astro:content';
import type {
  ResumeEducation,
  ResumeRole,
  ResumeSkillGroup,
  ResumeStat,
  ResumeStrength,
  ResumeTalk,
} from './resume.data';

/**
 * Turn resume collection entries into the shape the rendering surfaces consume.
 *
 * ## Why this is not in load.ts
 *
 * `load.ts` imports `getCollection` from `astro:content`, which only resolves
 * inside an Astro build. That made the assembly rules — which entry wins, how a
 * variant override applies, when a build should fail — unreachable from vitest,
 * and they are the rules most worth testing. Everything here depends on
 * `astro:content` for *types* only, and `import type` is erased before the
 * module runs, so this file loads anywhere.
 *
 * ## Why bullets come from the body
 *
 * Frontmatter holds what a machine needs and can validate: ISO dates for the
 * JSON-LD graph, the tier the visual page groups by, tags for retrieval. The
 * bullets are prose, so they live in the markdown body — which is also what
 * makes them reachable by A.I.R., since `ask.ts` carries bodies into the prompt.
 */

/** The sections the resume can reorder. Mirrors `profile.sectionOrder`. */
export type SectionName =
  | 'strengths'
  | 'experience'
  | 'skills'
  | 'speaking'
  | 'education';

/** What the rendering surfaces consume. Mirrors the old `RESUME` export. */
export interface Resume {
  /** Which variant this assembly is. Always a registered slug. */
  variant: string;
  name: string;
  headline: string;
  /** One line of chooser copy, when the variant supplies one. */
  pitch?: string;
  /** The section order this variant asks for, when it asks for one. */
  sectionOrder?: SectionName[];
  location: string;
  summary: string;
  longSummary: string;
  stats: ResumeStat[];
  strengths: ResumeStrength[];
  now: ResumeRole;
  experience: ResumeRole[];
  earliest: string;
  skills: ResumeSkillGroup[];
  speaking: {
    evaluation: string;
    talks: ResumeTalk[];
    footer: string;
    writing: { label: string; url: string; detail: string };
  };
  education: ResumeEducation[];
}

/** One resume entry, as the content collection hands it over. */
export type ResumeEntry = CollectionEntry<'resume'>;

/**
 * Bullets from a markdown body.
 *
 * Deliberately not a markdown parser: the body is a flat list of `- ` items by
 * schema, and pulling in a parser to find them would be machinery for one
 * construct. Continuation lines are joined, because a long bullet wraps.
 */
function parseBullets(body: string): string[] {
  const bullets: string[] = [];
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trimEnd();
    const item = line.match(/^\s*[-*]\s+(.*)$/);
    if (item) {
      bullets.push(item[1].trim());
    } else if (line.trim() && bullets.length > 0) {
      // A wrapped continuation of the previous bullet.
      bullets[bullets.length - 1] += ` ${line.trim()}`;
    }
  }
  return bullets;
}

/** The pre-2012 line, kept out of the role list because it carries no detail. */
const EARLIEST =
  'Technology Evangelist, **ngmoco/DeNA** (mobile gaming & social platform) · Software Engineer, **Noblis** (healthcare & government).';

/** Does this variant have prose of its own? */
export function hasVariantProfile(
  entries: ResumeEntry[],
  variant: string,
): boolean {
  return entries.some(
    (entry) =>
      entry.data.section === 'profile' &&
      (entry.data as { variant?: string }).variant === variant,
  );
}

/**
 * @param entries Either the real resume or the fixtures, never a mix.
 * @param variant Which framing to assemble. Singleton sections resolve
 *   variant-first and fall back to the default; experience is single-source
 *   with per-variant emphasis applied on top.
 */
export function assembleVariant(
  entries: ResumeEntry[],
  variant: string = DEFAULT_VARIANT,
): Resume {
  const bySection = <T extends string>(section: T) =>
    entries
      .filter((entry) => entry.data.section === section)
      .sort((a, b) => a.data.order - b.data.order);

  /**
   * The variant's own file if it has one, otherwise the default's.
   *
   * Fallback rather than failure, so a variant overrides only what it genuinely
   * reframes. Version C rewrites the profile, the strengths and the skills and
   * leaves speaking and education alone; duplicating the two it did not touch
   * would put the same facts in two files and let them drift.
   */
  const singleton = <T extends string>(section: T) => {
    const candidates = bySection(section);
    return (
      candidates.find(
        (entry) => (entry.data as { variant?: string }).variant === variant,
      ) ??
      candidates.find((entry) => !(entry.data as { variant?: string }).variant)
    );
  };

  const profile = singleton('profile');
  const strengths = singleton('strengths');
  const skills = singleton('skills');
  const speaking = singleton('speaking');
  const education = singleton('education');
  const roleEntries = bySection('experience');

  // A partial collection is a broken build, not a degraded one. Saying which
  // section is missing beats a downstream "cannot read property of undefined".
  const missing = [
    ['profile', profile],
    ['strengths', strengths],
    ['skills', skills],
    ['speaking', speaking],
    ['education', education],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0 || roleEntries.length === 0) {
    throw new Error(
      `resume collection is incomplete — missing: ${[
        ...missing,
        ...(roleEntries.length === 0 ? ['experience'] : []),
      ].join(', ')}`,
    );
  }

  const roles: ResumeRole[] = roleEntries.map((entry) => {
    const data = entry.data as Extract<
      typeof entry.data,
      { section: 'experience' }
    >;
    const bullets = parseBullets(entry.body ?? '');

    /*
     * Emphasis only. A variant may re-spotlight bullets and swap the condensed
     * opener; it may not change a fact, because the facts are the thing that
     * must stay single-source. `featured` replaces rather than extends: a
     * reframe is a different selection, not an addition.
     */
    const override =
      (
        data as {
          variants?: Record<
            string,
            { featured?: number[]; summary?: string; lede?: string }
          >;
        }
      ).variants?.[variant] ?? {};

    const featured = override.featured ?? data.featured;
    const lede = override.lede ?? data.lede;
    const summary = override.summary ?? data.summary;

    // An index past the end would silently drop emphasis on the visual page,
    // which is exactly the drift indices are vulnerable to when bullets are
    // edited. Fail the build instead.
    for (const index of featured) {
      if (index >= bullets.length) {
        throw new Error(
          `${entry.id}: featured index ${index} is past the last bullet (${bullets.length})`,
        );
      }
    }

    return {
      org: data.org,
      role: data.role,
      location: data.location,
      dates: data.dates,
      start: data.start,
      ...(data.end ? { end: data.end } : {}),
      ...(data.period ? { period: data.period } : {}),
      ...(lede ? { lede } : {}),
      ...(summary ? { summary } : {}),
      ...(data.compact ? { compact: data.compact } : {}),
      ...(data.chips.length ? { tags: [...data.chips] } : {}),
      ...(data.highlights.length ? { highlights: [...data.highlights] } : {}),
      tier: data.tier,
      bullets: bullets.map((text, index) => ({
        text,
        ...(featured.includes(index) ? { featured: true } : {}),
      })),
    };
  });

  // The current role is the one with no end date. Derived rather than flagged,
  // so it cannot disagree with the dates the JSON-LD graph publishes.
  const now = roles.find((role) => !role.end);
  if (!now)
    throw new Error(
      'resume collection has no current role (every entry has an end date)',
    );

  const profileData = profile!.data as Extract<
    ResumeEntry['data'],
    { section: 'profile' }
  >;
  const strengthsData = strengths!.data as Extract<
    ResumeEntry['data'],
    { section: 'strengths' }
  >;
  const skillsData = skills!.data as Extract<
    ResumeEntry['data'],
    { section: 'skills' }
  >;
  const speakingData = speaking!.data as Extract<
    ResumeEntry['data'],
    { section: 'speaking' }
  >;
  const educationData = education!.data as Extract<
    ResumeEntry['data'],
    { section: 'education' }
  >;

  return {
    variant,
    name: profileData.title.split('—')[0].trim(),
    headline: profileData.headline,
    ...(profileData.pitch ? { pitch: profileData.pitch } : {}),
    ...(profileData.sectionOrder
      ? { sectionOrder: [...profileData.sectionOrder] }
      : {}),
    location: profileData.location,
    summary: profileData.summary,
    // The profile body is the long form, for the machine page and the PDFs.
    longSummary: (profile!.body ?? '').trim(),
    stats: [...profileData.stats],
    strengths: strengthsData.items.map((item) => ({
      title: item.title,
      detail: item.detail,
      ...(item.wide ? { wide: true } : {}),
    })),
    now,
    experience: roles.filter((role) => role !== now),
    earliest: EARLIEST,
    skills: skillsData.groups.map((group) => ({
      group: group.group,
      tone: group.tone,
      items: [...group.items],
    })),
    speaking: {
      evaluation: speakingData.evaluation,
      talks: [...speakingData.talks],
      footer: speakingData.footer ?? '',
      writing: speakingData.writing ?? { label: '', url: '', detail: '' },
    },
    education: [...educationData.entries],
  };
}
