import { z, defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
import { showFixtures } from './util/visibility.mjs';

/**
 * Fixture content (`sample-*.md`) is opt-in — see showFixtures for why it
 * exists at all and why it defaults off.
 *
 * Read through the same helper as every other flag so "true" is the only
 * enabling value here too: a loose check would make PUBLIC_SHOW_FIXTURES=false
 * load them.
 */
const SHOW_FIXTURES = showFixtures(import.meta.env);

/**
 * `[!_]` skips `_template.md` — Astro's glob loader does not treat a leading
 * underscore as private, unlike the pages directory.
 */
const CONTENT_GLOB = SHOW_FIXTURES
  ? '**/[!_]*.md'
  : ['**/[!_]*.md', '!**/sample-*.md'];

const ProjectSchema = z.object({
  title: z.string(),
  description: z.string(),
  image: z.object({
    url: z.string(),
    alt: z.string(),
  }),
  worksImage1: z.object({
    url: z.string(),
    alt: z.string(),
  }),
  worksImage2: z.object({
    url: z.string(),
    alt: z.string(),
  }),
  platform: z.string(),
  stack: z.string(),
  website: z.string(),
  github: z.string(),
});

const projects = defineCollection({
  loader: glob({ pattern: CONTENT_GLOB, base: './src/content/projects' }),
  schema: ProjectSchema,
});

const BlogSchema = z.object({
  title: z.string(),
  // Reference a single author from the `authors` collection by `id`
  author: reference('authors'),
  // Reference an array of related posts from the `blog` collection by `id`
  relatedPosts: z.array(reference('blog')),
  blurb: z.string(),
  tags: z.array(z.string()),
  heroImage: z.object({
    url: z.string(),
    alt: z.string(),
  }),
  draft: z.boolean(),
  // When set, the post stays hidden until this moment. The site renders per
  // request, so a scheduled post goes live on its own — no rebuild needed.
  // Omit it to publish as soon as `draft` is false.
  publishDate: z.coerce.date().optional(),
});

const blog = defineCollection({
  loader: glob({ pattern: CONTENT_GLOB, base: './src/content/blog' }),
  schema: BlogSchema,
});

const AuthorSchema = z.object({
  name: z.string(),
  portfolio: z.string().url(),
});

const authors = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/authors' }),
  schema: AuthorSchema,
});

// STAR (Situation / Task / Action / Result) career highlights. Rotated on the
// home page; `draft` entries are hidden in production like blog posts.
const star = defineCollection({
  // `[!_]` keeps `_template.md` out of the collection. The glob loader does
  // not skip underscore-prefixed files, so without this the spotlight can
  // rotate onto the template and render its placeholder copy as a highlight.
  loader: glob({ pattern: CONTENT_GLOB, base: './src/content/star' }),
  schema: z.object({
    title: z.string(),
    situation: z.string(),
    task: z.string(),
    action: z.string(),
    result: z.string(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

/**
 * Recently updated public repositories, fetched at build time and baked into
 * the page — no runtime API call, no token in the Worker, and a GitHub outage
 * cannot affect the live site.
 *
 * Failures are deliberately non-fatal: a rate-limited or unreachable API
 * yields an empty collection and the section simply does not render, rather
 * than breaking the build (and therefore every deploy).
 */
const latestWork = defineCollection({
  loader: async () => {
    const user = process.env.GITHUB_USER ?? 'pixelknitter';
    const token = process.env.GITHUB_TOKEN;
    const url =
      `https://api.github.com/users/${user}/repos` +
      `?sort=pushed&direction=desc&per_page=12&type=owner`;

    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'eddies-portfolio-build',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        console.warn(
          `[latest-work] GitHub responded ${response.status}; section will be omitted.`,
        );
        return [];
      }

      const repos = (await response.json()) as Array<Record<string, unknown>>;

      return repos
        .filter((repo) => !repo.fork && !repo.archived && !repo.private)
        .slice(0, 6)
        .map((repo) => ({
          id: String(repo.name),
          name: String(repo.name),
          description: repo.description ? String(repo.description) : null,
          url: String(repo.html_url),
          language: repo.language ? String(repo.language) : null,
          stars: Number(repo.stargazers_count ?? 0),
          pushedAt: String(repo.pushed_at),
        }));
    } catch (error) {
      console.warn(
        `[latest-work] Could not reach GitHub (${
          error instanceof Error ? error.message : error
        }); section will be omitted.`,
      );
      return [];
    }
  },
  schema: z.object({
    name: z.string(),
    description: z.string().nullable(),
    url: z.string().url(),
    language: z.string().nullable(),
    stars: z.number(),
    pushedAt: z.string(),
  }),
});

/**
 * The resume, as content.
 *
 * One entry per role, plus one per supporting section. Folders are the sections
 * (`experience/frontdoor.md`, `skills/skills.md`), so `entry.id` carries the
 * section and the loader needs no naming convention to parse.
 *
 * ## Why the body holds the prose
 *
 * Unlike `star`, where the body is a note *about* the content, a resume body is
 * the content: the bullets, as markdown. Structure that a machine needs — ISO
 * dates for the JSON-LD graph, the tier the visual page groups by — lives in
 * frontmatter, where it can be validated. `ask.ts` labels the two kinds of body
 * differently when it builds the A.I.R. corpus, so nothing downstream guesses.
 *
 * ## Tags carry search vocabulary, not just technologies
 *
 * `WEIGHTS.tags` is the second-heaviest retrieval signal, and real questions are
 * asked in the asker's words — "did he manage people", "how does he handle
 * incidents" — so tags include role and practice terms alongside the stack.
 *
 * A discriminated union rather than one permissive schema with everything
 * optional: a role without `start` should fail the build, and it only can if the
 * section decides which fields are required.
 */
const resumeBase = {
  title: z.string(),
  /** Free-text keywords, including soft skills. See the note above. */
  tags: z.array(z.string()).default([]),
  /** Ordering within a section, low first. */
  order: z.number().default(50),
};

const ResumeSchema = z.discriminatedUnion('section', [
  z.object({
    ...resumeBase,
    section: z.literal('profile'),
    headline: z.string(),
    location: z.string(),
    /** Condensed, for the visual page. The body carries the long form. */
    summary: z.string(),
    stats: z
      .array(z.object({ value: z.string(), label: z.string() }))
      .default([]),
  }),
  z.object({
    ...resumeBase,
    section: z.literal('experience'),
    org: z.string(),
    role: z.string(),
    location: z.string(),
    /** Human-facing span, e.g. "Feb 2023 – Jul 2026". */
    dates: z.string(),
    /**
     * ISO 8601 year-month. These exist for the JSON-LD graph: a generative
     * engine can order a career from `2023-02` and has to guess at "Feb 2023".
     * `end` absent is what marks a role current — never a "Present" sentinel,
     * which a parser reads as a malformed date.
     */
    start: z.string().regex(/^\d{4}-\d{2}$/),
    end: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
    /** Which block of the visual page this role appears in. */
    tier: z.enum(['selected', 'earlier']),
    /** Short label for the "Earlier career" grid, e.g. "2018 – 2019". */
    period: z.string().optional(),
    /** Scene-setting line, italicised. */
    lede: z.string().optional(),
    /** Condensed opening paragraph for the visual page. */
    summary: z.string().optional(),
    /** One-line form for the "Earlier career" grid. */
    compact: z.string().optional(),
    /**
     * Display chips rendered under the role on the visual page — the domains the
     * platform spans, or a client list.
     *
     * Distinct from `tags`, which is retrieval vocabulary and never rendered.
     * Conflating the two silently dropped this data during the migration; the
     * golden-render diff is what caught it.
     */
    chips: z.array(z.string()).default([]),
    /** Outcome cards shown above the bullets on the visual page. */
    highlights: z
      .array(z.object({ value: z.string(), detail: z.string() }))
      .default([]),
    /**
     * 0-based indices of the body bullets the visual page shows.
     *
     * Indices rather than a marker in the prose: the bullets are in a deliberate
     * order the complete renderings depend on, and a featured set is rarely a
     * prefix — so grouping them under a heading would silently reorder the
     * document, and an inline marker would leak into both the page and the
     * A.I.R. context. The loader checks every index is in range.
     */
    featured: z.array(z.number().int().nonnegative()).default([]),
  }),
  z.object({
    ...resumeBase,
    section: z.literal('strengths'),
    items: z.array(
      z.object({
        title: z.string(),
        detail: z.string(),
        wide: z.boolean().default(false),
      }),
    ),
  }),
  z.object({
    ...resumeBase,
    section: z.literal('skills'),
    groups: z.array(
      z.object({
        group: z.string(),
        tone: z.enum(['accent', 'accent-2', 'neutral']),
        items: z.array(z.string()),
      }),
    ),
  }),
  z.object({
    ...resumeBase,
    section: z.literal('speaking'),
    evaluation: z.string(),
    talks: z
      .array(
        z.object({
          org: z.string(),
          title: z.string(),
          url: z.string().url(),
          detail: z.string(),
        }),
      )
      .default([]),
    footer: z.string().optional(),
    writing: z
      .object({ label: z.string(), url: z.string().url(), detail: z.string() })
      .optional(),
  }),
  z.object({
    ...resumeBase,
    section: z.literal('education'),
    entries: z.array(
      z.object({
        period: z.string(),
        institution: z.string(),
        detail: z.string(),
      }),
    ),
  }),
]);

const resume = defineCollection({
  loader: glob({ pattern: CONTENT_GLOB, base: './src/content/resume' }),
  schema: ResumeSchema,
});

export const collections = {
  projects,
  blog,
  authors,
  star,
  latestWork,
  resume,
};
