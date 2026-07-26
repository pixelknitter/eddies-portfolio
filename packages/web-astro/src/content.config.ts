import { z, defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';

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
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
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
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
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
  loader: glob({ pattern: '**/[!_]*.md', base: './src/content/star' }),
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
          `[latest-work] GitHub responded ${response.status}; section will be omitted.`
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
        }); section will be omitted.`
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

export const collections = { projects, blog, authors, star, latestWork };
