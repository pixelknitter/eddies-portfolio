import { getCollection } from 'astro:content';

import type {
  ResumeEducation,
  ResumeRole,
  ResumeSkillGroup,
  ResumeStat,
  ResumeStrength,
  ResumeTalk,
} from './resume.data';

/**
 * Assemble the resume from the content collection.
 *
 * Returns the same shape `resume.data.ts` used to export, so the four rendering
 * surfaces — the visual page, the machine-readable page and both print routes —
 * changed only their import. That was the point of keeping the shape: the
 * migration is a change of *source*, not of everything downstream.
 *
 * ## Why bullets come from the body
 *
 * Frontmatter holds what a machine needs and can validate: ISO dates for the
 * JSON-LD graph, the tier the visual page groups by, tags for retrieval. The
 * bullets are prose, so they live in the markdown body — which is also what makes
 * them reachable by A.I.R., since `ask.ts` now carries bodies into the prompt.
 *
 * ## Empty means missing, not empty
 *
 * The content is sealed. A build with no `CONTENT_SEAL_KEY` and no fixtures loads
 * zero entries, and every resume route 404s rather than publishing a header with
 * seven empty sections and a JSON-LD graph asserting a person with no work
 * history. `loadResume` returns null for that case; the routes check it.
 */

/** What the rendering surfaces consume. Mirrors the old `RESUME` export. */
export interface Resume {
  name: string;
  headline: string;
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

/**
 * @returns The assembled resume, or null when the collection is empty — which
 *   means the seal key is absent, not that the resume is blank.
 */
export async function loadResume(): Promise<Resume | null> {
  const entries = await getCollection('resume');
  if (entries.length === 0) return null;

  const bySection = <T extends string>(section: T) =>
    entries
      .filter((entry) => entry.data.section === section)
      .sort((a, b) => a.data.order - b.data.order);

  const profile = bySection('profile')[0];
  const strengths = bySection('strengths')[0];
  const skills = bySection('skills')[0];
  const speaking = bySection('speaking')[0];
  const education = bySection('education')[0];
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

    // An index past the end would silently drop emphasis on the visual page,
    // which is exactly the drift indices are vulnerable to when bullets are
    // edited. Fail the build instead.
    for (const index of data.featured) {
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
      ...(data.lede ? { lede: data.lede } : {}),
      ...(data.summary ? { summary: data.summary } : {}),
      ...(data.compact ? { compact: data.compact } : {}),
      ...(data.chips.length ? { tags: [...data.chips] } : {}),
      ...(data.highlights.length ? { highlights: [...data.highlights] } : {}),
      tier: data.tier,
      bullets: bullets.map((text, index) => ({
        text,
        ...(data.featured.includes(index) ? { featured: true } : {}),
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

  const profileData = profile.data as Extract<
    typeof profile.data,
    { section: 'profile' }
  >;
  const strengthsData = strengths.data as Extract<
    typeof strengths.data,
    { section: 'strengths' }
  >;
  const skillsData = skills.data as Extract<
    typeof skills.data,
    { section: 'skills' }
  >;
  const speakingData = speaking.data as Extract<
    typeof speaking.data,
    { section: 'speaking' }
  >;
  const educationData = education.data as Extract<
    typeof education.data,
    { section: 'education' }
  >;

  return {
    name: profileData.title.split('—')[0].trim(),
    headline: profileData.headline,
    location: profileData.location,
    summary: profileData.summary,
    // The profile body is the long form, for the machine page and the PDFs.
    longSummary: (profile.body ?? '').trim(),
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
