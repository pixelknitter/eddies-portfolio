import { z, defineCollection, reference } from 'astro:content';

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
  type: 'content',
  schema: ProjectSchema,
});

export type Project = z.infer<typeof ProjectSchema>;

const BlogSchema = z.object({
  title: z.string(),
  // Reference a single author from the `authors` collection by `id`
  author: reference('authors'),
  // Reference an array of related posts from the `blog` collection by `slug`
  relatedPosts: z.array(reference('blog')),
  blurb: z.string(),
  tags: z.array(z.string()),
  heroImage: z.object({
    url: z.string(),
    alt: z.string(),
  }),
  draft: z.boolean(),
});

const blog = defineCollection({
  type: 'content',
  schema: BlogSchema,
});
// , 'author' | 'relatedPosts'> & { author: Author, relatedPosts: string[] };
export type BlogPost = z.infer<typeof BlogSchema>
// FIXME: get the available slugs for posts

const AuthorSchema = z.object({
  name: z.string(),
  portfolio: z.string().url(),
});

const authors = defineCollection({
  type: 'data',
  schema: AuthorSchema,
});

export type Author = z.infer<typeof AuthorSchema>;

export const collections = { projects, blog, authors };
