# CLAUDE.md - AI Assistant Guide for Eddie's Portfolio

> **Version:** 0.4.0
> **Last Updated:** 2026-07-25
> **Purpose:** This document provides comprehensive guidance for AI assistants working with Eddie Freeman's portfolio codebase.

> **Note:** The tech stack was modernized in July 2026 (Astro 7, React 19,
> Tailwind 4, Nx 23, ESLint 9 flat config, Node 22, Vitest). Sections below
> reflect the current state; see the git history for the migration commits.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture & Structure](#architecture--structure)
3. [Technology Stack](#technology-stack)
4. [Development Workflows](#development-workflows)
5. [Code Conventions & Patterns](#code-conventions--patterns)
6. [Content Management](#content-management)
7. [Styling & Theming](#styling--theming)
8. [Testing](#testing)
9. [Deployment](#deployment)
10. [Common Tasks](#common-tasks)
11. [Important Guidelines](#important-guidelines)

---

## Project Overview

**Project Name:** eddies-portfolio
**Type:** Personal Portfolio Website
**Architecture:** Nx Monorepo with Astro Static Site Generator
**Owner:** Eddie Freeman
**License:** MIT

### Purpose
A professional portfolio website showcasing Eddie's work, blog posts, projects, and skills. The site features a modern design with dark/light theme support, interactive components, and optimized performance for Cloudflare Workers deployment.

### Key Features
- Personal about section with skills/tech stack display
- Blog with markdown content (draft support)
- Project showcase with detailed case studies
- AI Resume interactive component (in development)
- Dark/light theme with persistence and cross-tab sync
- Responsive design with mobile-first approach
- Server-side rendering on Cloudflare Workers

---

## Architecture & Structure

### Monorepo Structure

This is an **Nx v19 monorepo** with Yarn 3 workspaces:

```
eddies-portfolio/
├── packages/
│   ├── web-astro/          # Main Astro application
│   └── web-astro-e2e/      # Cypress E2E tests
├── nx.json                 # Nx workspace configuration
├── package.json            # Root workspace dependencies
├── tsconfig.base.json      # Shared TypeScript config
└── [config files]          # ESLint, Prettier, etc.
```

### Web-Astro Application Structure

**Location:** `/packages/web-astro/`

```
src/
├── pages/                  # File-based routing (Astro convention)
│   ├── index.astro        # Home page (about section)
│   ├── blog.astro         # Blog listing
│   ├── blog/[...slug].astro    # Dynamic blog posts
│   ├── works.astro        # Projects listing
│   ├── projects/[...slug].astro # Dynamic project pages
│   ├── air/index.astro    # AI Resume page
│   └── 404.astro          # Error page
│
├── layouts/               # Reusable page layouts
│   ├── Layout.astro       # Base layout (header, footer, theme)
│   ├── MarkdownBlogLayout.astro   # Blog post template
│   └── MarkdownWorksLayout.astro  # Project detail template
│
├── components/            # Astro components (server-side)
│   ├── Header.astro       # Navigation container
│   ├── Navigation.astro   # Nav links with theme toggle
│   ├── Footer.astro       # Social links & copyright
│   ├── Card.astro         # Reusable card component
│   ├── Badge.astro        # Tech stack icons with tooltips
│   ├── MyBlocksSection.astro # Skill categories
│   ├── Hero.astro         # Hero image sections
│   ├── Prose.astro        # Markdown wrapper
│   ├── AnimateOnScroll.astro # Scroll animations
│   └── ThemeIcon.astro    # Theme toggle button
│
├── content.config.ts      # Content Layer schemas + glob loaders
│                          #   (NOT src/content/config.ts)
├── content/               # Content collection sources
│   ├── blog/              # Blog markdown files
│   ├── projects/          # Project markdown files
│   └── authors/           # Author data (JSON)
│
├── react/                 # React components (islands)
│   ├── AIResume.tsx       # Interactive AI resume
│   └── AIResume.spec.tsx  # Vitest render/interaction test
│
├── static/                # Static markdown files
│   └── about.md           # Home page about content
│
├── styles/
│   ├── global.css         # @import "tailwindcss" + @theme tokens
│   └── motion.css         # Motion/animation variables
│
└── util/
    ├── constants.ts       # Environment vars, tech stack data
    └── constants.spec.ts  # Vitest data-integrity test
```

> Tailwind 4 has **no** `tailwind.config.cjs`. ESLint uses a flat config
> (`eslint.config.mjs` at the root, extended per package). Vitest config is
> `vitest.config.mts` + `vitest.setup.ts` in the package root.

### Path Aliases

Configured in `tsconfig.base.json` for cleaner imports:

```typescript
@components/* → src/components/*
@layouts/* → src/layouts/*
@content/* → src/content/*
@static/* → src/static/*
@util/* → src/util/*
```

**Usage Example:**
```typescript
import Card from '@components/Card.astro';
import { TECH_STACK } from '@util/constants';
```

---

## Technology Stack

### Core Framework
- **Astro 7.1.3** - Static site generator with server output for Cloudflare
- **React 19.2** - For interactive islands (minimal client-side JS)
- **TypeScript 5.7** - Strict mode enabled (`moduleResolution: bundler`)

### Styling
- **Tailwind CSS 4** - Utility-first CSS, **CSS-first config** via
  `@theme` in `src/styles/global.css` (no `tailwind.config.cjs`)
- **@tailwindcss/vite** - Tailwind is a Vite plugin (not `@astrojs/tailwind`)
- **@tailwindcss/typography** - Styled prose content (loaded via `@plugin`)

### Build Tools
- **Nx 23** - Monorepo build/caching; targets run the Astro CLI via
  `nx:run-commands` (the abandoned `@nxtensions/astro` plugin was removed)
- **Yarn 3.8.2** - Package manager (node-modules linker)
- **Node 22.12** - see `.nvmrc`

### Testing
- **Vitest** - Unit/integration tests (jsdom + Testing Library); Nx `test`
  target. Specs live next to source as `*.spec.ts(x)`
- **Cypress** - E2E scaffold (placeholder; its binary does not build in all
  sandboxes — prefer Vitest for new coverage)

### Code Quality
- **ESLint 9** - Flat config (`eslint.config.mjs`), typescript-eslint v8
- **Prettier 3** - Formatting with Tailwind 4 class sorting + Astro plugin

### Deployment
- **@astrojs/cloudflare 14** - Cloudflare **Workers** adapter (Wrangler 4). Pages is no longer supported by the adapter.
- **GitHub Actions** - CI (`.github/workflows/ci.yml`) + deploy
  (`deploy.yml`, staging → production); local Nx caching (Nx Cloud removed)

---

## Development Workflows

### Prerequisites

```bash
# Required Node version
node --version  # Should be v22.12.0 (see .nvmrc)

# Install dependencies
yarn install
```

### Development Commands

```bash
# Start development server (http://localhost:4321)
yarn astro:dev
# or
nx dev web-astro

# Build for production
yarn astro:build
# or
nx build web-astro

# Preview production build
yarn astro:preview
# or
nx preview web-astro

# TypeScript type checking
nx check web-astro

# Unit tests (Vitest)
nx test web-astro
nx test web-astro --configuration=watch

# Lint (ESLint 9 flat config)
nx lint web-astro

# Run all CI targets at once
yarn ci   # -> nx run-many --targets=check,lint,test,build --projects=web-astro
```

> **CI parity:** the GitHub Actions workflow runs `check`, `lint`, `test`,
> and `build`. Cypress's binary is skipped in install (`CYPRESS_INSTALL_BINARY=0`)
> and the Nx daemon is disabled (`NX_DAEMON=false`).

### Nx Caching

Nx caches build outputs, lint results, and test runs for faster rebuilds:
- Cache: local only (`.nx/cache`); Nx Cloud has been removed
- Clear cache: `nx reset`
- CI disables the daemon (`NX_DAEMON=false`) for deterministic runs

### File Watching

Astro dev server automatically watches for changes:
- `.astro` files - Hot module replacement
- Markdown content - Auto-refresh
- CSS changes - Instant updates
- TypeScript changes - Automatic recompilation

---

## Code Conventions & Patterns

### File Naming

- **Astro components:** PascalCase (e.g., `Card.astro`, `MyBlocksSection.astro`)
- **TypeScript files:** camelCase (e.g., `constants.ts`)
- **Markdown content:** kebab-case (e.g., `step-by-step.md`, `project-1.md`)
- **Dynamic routes:** `[...slug].astro` for catch-all routing

### Astro Component Structure

```astro
---
// Frontmatter: TypeScript code executed at build time
interface Props {
  title: string;
  tech?: Badge[];
}

const { title, tech = [] } = Astro.props;

// Server-side logic here
---

<!-- Template: HTML with Astro syntax -->
<div class="container">
  <h1>{title}</h1>
  {tech.map(t => <Badge {...t} />)}
</div>

<style>
  /* Scoped styles (optional) */
  .container {
    /* Component-specific CSS */
  }
</style>
```

### Props Typing

Always define TypeScript interfaces for component props:

```typescript
interface Props {
  title: string;           // Required prop
  description?: string;    // Optional prop
  tags: string[];          // Array prop
  draft?: boolean;         // Boolean with default
}

const {
  title,
  description = "No description",
  tags,
  draft = false
} = Astro.props;
```

### React Islands

React components use the islands architecture (minimal client-side JS):

```astro
---
import AIResume from '@/react/AIResume';
---

<!-- client:load = Interactive on page load -->
<AIResume client:load />

<!-- Other directives:
  client:idle - Load when main thread is idle
  client:visible - Load when visible in viewport
  client:media - Load based on media query
  client:only - Skip server-side rendering
-->
```

### Content Collections

Content uses the **Content Layer API** (Astro 5+). Collections are typed with
Zod schemas and `glob()` loaders in `src/content.config.ts` (note: this file
lives at `src/content.config.ts`, **not** `src/content/config.ts`):

```typescript
import { defineCollection, z, reference } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    author: reference('authors'),
    relatedPosts: z.array(reference('blog')),
    tags: z.array(z.string()),
    draft: z.boolean(),
    heroImage: z.object({ url: z.string(), alt: z.string() }),
    blurb: z.string(),
  }),
});
```

**Querying content** (Content Layer: use `entry.id` as the slug, and the
top-level `render()` function):

```typescript
import { getCollection, render } from 'astro:content';

// Get all blog posts (filtering drafts in production)
const posts = await getCollection('blog', ({ data }) => {
  return import.meta.env.PROD ? data.draft !== true : true;
});

// entry.id is the slug (e.g. "hello"); render markdown:
const { Content } = await render(posts[0]);
```

> **Migration notes (from legacy collections):** `entry.slug` → `entry.id`;
> `entry.render()` → `render(entry)`; for frontmatter prop types use
> `CollectionEntry<'blog'>['data']` rather than custom `z.infer` exports.

### Responsive Design Patterns

Use Tailwind's mobile-first breakpoints:

```astro
<div class="
  grid grid-cols-1       <!-- Mobile: 1 column -->
  md:grid-cols-2         <!-- Tablet: 2 columns -->
  lg:grid-cols-3         <!-- Desktop: 3 columns -->
  gap-4                  <!-- Consistent spacing -->
">
  <!-- Content -->
</div>
```

### Animation Patterns

Respect user motion preferences:

```css
/* In global.css or component styles */
@media (prefers-reduced-motion: no-preference) {
  .animate {
    animation: fadeIn 0.5s ease-in-out;
  }
}

@media (prefers-reduced-motion: reduce) {
  .animate {
    animation: none;
  }
}
```

### Import Ordering Convention

1. Astro/framework imports
2. Component imports (using path aliases)
3. Type imports
4. Utility/constant imports
5. CSS imports (if needed)

```typescript
---
import { getCollection } from 'astro:content';
import Layout from '@layouts/Layout.astro';
import Card from '@components/Card.astro';
import type { CollectionEntry } from 'astro:content';
import { SITE_TITLE } from '@util/constants';
---
```

---

## Content Management

### Content Collections Overview

Three collections defined in `src/content.config.ts`:

1. **Blog** - Blog posts (markdown with frontmatter)
2. **Projects** - Project showcases (markdown with frontmatter)
3. **Authors** - Author data (JSON files)

### Adding a New Blog Post

1. Create file: `src/content/blog/my-post.md`
2. Add frontmatter:

```markdown
---
title: "My Blog Post Title"
author: eddie-freeman
tags: ["typescript", "astro"]
blurb: "A short description"
heroImage: "/images/hero.webp"
draft: false
relatedPosts: ["other-post-slug"]
---

Your markdown content here...
```

3. The post automatically appears on `/blog` (unless `draft: true` in production)
4. Dynamic route `/blog/my-post` is generated

### Adding a New Project

1. Create file: `src/content/projects/project-name.md`
2. Add frontmatter:

```markdown
---
title: "Project Name"
description: "Project description"
image: "/project-card.webp"
worksImage1: "/detail-image-1.webp"
worksImage2: "/detail-image-2.webp"
platform: "Web"
stack: ["React", "TypeScript", "Tailwind"]
website: "https://example.com"
github: "https://github.com/user/repo"
---

Project details in markdown...
```

3. Project appears on `/works` and generates `/projects/project-name`

### Static Assets

Place in `public/` directory:
- Images: `public/image.webp`
- Icons: `public/favicon.svg`
- Other assets: `public/file.pdf`

Reference without `/public` prefix:
```astro
<img src="/image.webp" alt="Description" />
```

### Environment-Based Content

Draft posts are hidden in production:

```typescript
// Automatically filtered in production
const posts = await getCollection('blog', ({ data }) => {
  return import.meta.env.PROD ? !data.draft : true;
});
```

---

## Styling & Theming

### Tailwind Configuration (Tailwind 4, CSS-first)

Tailwind 4 has **no JS config file**. Theme tokens live in an `@theme` block
in `packages/web-astro/src/styles/global.css`, and Tailwind runs as a Vite
plugin (`@tailwindcss/vite` in `astro.config.mjs`). Content sources are
auto-detected — no `content` array.

```css
/* src/styles/global.css */
@import "tailwindcss";
@plugin "@tailwindcss/typography";

/* Class-based dark mode (the app toggles `.dark` on <html>). */
@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --color-dark: #1e1e2e;      /* dark bg */
  --color-light: #fdebf3;     /* light bg */
  --color-button: #5dd39e;
  --color-link: #5dd39e;
  --color-underline: #348aa7;
  --color-emphasis: #525174;
  --color-tag: #584966;
  --color-disabled: #5c5b77;

  --font-header: "Pacifico", cursive;
  --font-body: "Josefin Sans", sans-serif;
}
```

> **Gotcha:** `@apply` inside an Astro component's scoped `<style>` needs a
> `@reference "../styles/global.css";` at the top of that block to resolve
> theme tokens (see `Badge.astro`). Also, Tailwind 4 removed the standalone
> `transform` utility — translate/scale/rotate compose automatically.

### Dark Mode Implementation

**Class-based dark mode** (via the `@custom-variant dark` above) with
localStorage persistence. An inline script in `Layout.astro` applies the
theme on load and after view transitions:

```javascript
// In Layout.astro
<script>
  function applyTheme() {
    const theme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', theme === 'dark' || (!theme && prefersDark));
  }
  applyTheme();
  document.addEventListener('astro:after-swap', applyTheme);
  window.addEventListener('storage', (e) => { if (e.key === 'theme') applyTheme(); });
</script>
```

**Toggle component:** `ThemeIcon.astro`
- Persists to localStorage
- Syncs across tabs using storage events
- Smooth transitions between themes

### Tailwind CSS Layers

**Base Layer:**
```css
@layer base {
  /* Typography defaults */
  h1, h2, h3, h4, h5, h6 { @apply font-head; }
  body { @apply font-body; }
}
```

**Components Layer:**
```css
@layer components {
  .nav-link { /* ... */ }
  .badge { /* ... */ }
  .btn { /* ... */ }
  .card-grid {
    @apply grid gap-4;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  }
}
```

**Utilities Layer:**
```css
@layer utilities {
  /* Custom utilities if needed */
}
```

### Responsive Breakpoints

Standard Tailwind breakpoints:
- `sm:` - 640px
- `md:` - 768px
- `lg:` - 1024px
- `xl:` - 1280px
- `2xl:` - 1536px

---

## Testing

### Unit/Integration Testing with Vitest

**Config:** `packages/web-astro/vitest.config.mts` (lean, framework-agnostic —
avoids loading the Cloudflare adapter). Setup: `vitest.setup.ts`.

**Run tests:**
```bash
nx test web-astro                      # single run
nx test web-astro --configuration=watch
```

**Conventions:**
- Co-locate specs with source: `src/**/*.spec.ts` or `*.spec.tsx`
- React islands: render with `@testing-library/react` + `jsdom`
- Plain modules (e.g. `constants.ts`): assert data shape/invariants
- Astro component rendering is covered by the `build` target in CI, not unit
  tests

**Example:**
```typescript
// src/util/constants.spec.ts
import { describe, it, expect } from 'vitest';
import { buildingBlocks } from './constants';

describe('buildingBlocks', () => {
  it('gives every badge a label and tech key', () => {
    for (const badge of Object.values(buildingBlocks).flat()) {
      expect(badge.label).toBeTruthy();
      expect(badge.tech).toBeTruthy();
    }
  });
});
```

### E2E Testing with Cypress

**Location:** `packages/web-astro-e2e/` — placeholder scaffold only. The
Cypress binary does not build in all sandboxes; prefer Vitest for new
coverage until E2E is revisited (consider Playwright).

### Type Checking

```bash
nx check web-astro
```

Runs `astro check` for TypeScript validation in `.astro` files.

### Linting

```bash
nx lint web-astro
nx lint web-astro --fix
```

---

## Deployment

### Cloudflare Workers

**Adapter:** `@astrojs/cloudflare` 14 (Wrangler 4)
**Output Mode:** Server (SSR enabled)
**Build Output:** `packages/web-astro/dist/` — split into `client/` (static
assets) and `server/` (Worker entry + generated `wrangler.json`)

> **Deploy with `wrangler deploy`, never `wrangler pages deploy`.** The
> adapter dropped Cloudflare Pages support and emits a Worker. Pushing this
> tree to Pages "succeeds" but uploads `client/` and `server/` as plain
> folders, leaving nothing at `/` — every route 404s.

Base Worker config lives in `packages/web-astro/wrangler.jsonc` (name,
compatibility date, `workers_dev`); the adapter merges it with the generated
entry point, `ASSETS` binding and `SESSION` KV binding at build time.

**Astro configuration:**
```javascript
// astro.config.mjs
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  outDir: './dist',                 // package-local — see note below
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
  output: 'server',
  adapter: cloudflare({
    imageService: 'passthrough',
    platformProxy: { enabled: false },
  }),
});
```

> **Why `outDir: './dist'` (not the Nx `dist/packages/web-astro`)?** The
> Cloudflare adapter v14 prerenders pages through **workerd**, whose
> filesystem sandbox rejects paths containing `..`. Output must live inside
> the project root. The Nx `build` target declares `{projectRoot}/dist` as its
> output; the deploy workflow publishes `packages/web-astro/dist`.

### CI/CD (GitHub Actions)

- **`.github/workflows/ci.yml`** — runs `check`, `lint`, `test`, `build` on
  push/PR.
- **`.github/workflows/preview.yml`** — per-PR **dev** Worker on
  `<branch>-dev.eddie.engineering`, smoke-tested, URL commented on the PR.
- **`.github/workflows/preview-cleanup.yml`** — tears that Worker down when
  the PR closes.
- **`.github/workflows/deploy.yml`** — on green `master`: deploys **staging**
  (`staging.eddie.engineering`) automatically, then **production**
  (`eddie.engineering`) after approval, in one run.

Three tiers, each its own Worker so a lower tier can never claim the
production hostname:

| Tier | Hostname | Worker | GitHub environment |
|------|----------|--------|--------------------|
| Production | `eddie.engineering` | `eddies-portfolio` | `production` |
| Staging | `staging.eddie.engineering` | `eddies-portfolio-staging` | `staging` |
| Dev (per PR) | `<branch>-dev.eddie.engineering` | `eddies-portfolio-pr-<N>` | `development` |

Cloudflare credentials and Discord webhooks are **repo-level secrets**;
environments are declared for deployment tracking and the production
approval gate.

Documentation lives in `docs/`:

| Doc | Purpose |
|-----|---------|
| `docs/FEATURES.md` | What each capability does and which problem it solves |
| `docs/RUNBOOK.md` | Known failure modes and operational procedures |
| `docs/DEPLOYMENT.md` | Environment/deploy reference: hostnames, secrets, Access |
| `docs/VOICE.md` | Writing voice for posts |

### Build Process

```bash
# Build for production
yarn astro:build

# Output location
packages/web-astro/dist/
```

### Environment Variables

Define in the Cloudflare Workers dashboard or `.env`:

```bash
OPEN_AI_TOKEN=your_token_here
SHOW_BLOG=true
SHOW_PROJECTS=true
SHOW_AIR=false
```

Access in code:
```typescript
const apiToken = import.meta.env.OPEN_AI_TOKEN;
const showBlog = import.meta.env.SHOW_BLOG === 'true';
```

---

## Common Tasks

### Adding a New Astro Component

1. Create file: `src/components/MyComponent.astro`
2. Define props interface:
```astro
---
interface Props {
  title: string;
  items?: string[];
}

const { title, items = [] } = Astro.props;
---

<div class="my-component">
  <h2>{title}</h2>
  <ul>
    {items.map(item => <li>{item}</li>)}
  </ul>
</div>

<style>
  .my-component {
    /* Scoped styles */
  }
</style>
```

3. Import and use:
```astro
---
import MyComponent from '@components/MyComponent.astro';
---

<MyComponent title="Hello" items={['a', 'b', 'c']} />
```

### Adding a New Page

1. Create file: `src/pages/my-page.astro`
2. Use Layout:
```astro
---
import Layout from '@layouts/Layout.astro';
---

<Layout title="My Page">
  <main>
    <h1>My Page Content</h1>
  </main>
</Layout>
```

3. Page automatically available at `/my-page`

### Updating Tech Stack Data

Edit `src/util/constants.ts`:

```typescript
export const TECH_STACK = {
  Languages: [
    { name: 'TypeScript', icon: 'typescript-icon.svg' },
    // ...
  ],
  Frameworks: [
    { name: 'Astro', icon: 'astro-icon.svg' },
    // ...
  ],
  // ...
};
```

### Modifying Theme Colors

1. Edit the `@theme` block in `src/styles/global.css`:
```css
@theme {
  --color-primary: #new-color;
}
```

2. Use in components (the `--color-primary` token generates `*-primary`
   utilities):
```astro
<div class="bg-primary text-white">
  <!-- Content -->
</div>
```

### Adding Global Styles

Edit `src/styles/global.css`:

```css
@layer base {
  /* Base styles */
}

@layer components {
  .my-component-class {
    @apply flex items-center gap-4;
  }
}

@layer utilities {
  .text-gradient {
    @apply bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent;
  }
}
```

---

## Important Guidelines

### DO ✅

1. **Use path aliases** for imports (`@components/`, `@layouts/`, etc.)
2. **Type all component props** with TypeScript interfaces
3. **Follow mobile-first** responsive design with Tailwind
4. **Respect user preferences** (prefers-reduced-motion, prefers-color-scheme)
5. **Use Astro components** by default (server-side rendering)
6. **Use React islands** only when interactivity is needed
7. **Filter draft content** in production builds
8. **Test changes** with `nx dev web-astro` before building
9. **Run type checking** with `nx check web-astro`
10. **Use semantic HTML** (nav, main, article, section, etc.)
11. **Add alt text** to all images for accessibility
12. **Leverage Nx caching** - let Nx handle build optimization
13. **Use content collections** for blog/project content
14. **Follow existing naming conventions** for consistency

### DON'T ❌

1. **Don't bypass TypeScript** - avoid `any` types
2. **Don't skip accessibility** - ensure keyboard navigation works
3. **Don't hardcode values** - use constants from `@util/constants`
4. **Don't use inline styles** - use Tailwind utilities or scoped CSS
5. **Don't forget dark mode** - test both light and dark themes
6. **Don't ignore ESLint warnings** - fix or properly suppress them
7. **Don't add React components unnecessarily** - Astro components are faster
8. **Don't modify core Nx configuration** without understanding impact
9. **Don't commit sensitive data** - use environment variables
10. **Don't break existing layouts** - maintain component contracts
11. **Don't skip type checking** - run `nx check` before committing
12. **Don't use `client:load` everywhere** - prefer `client:idle` or `client:visible`
13. **Don't create duplicate utilities** - check Tailwind first
14. **Don't ignore responsive design** - test on mobile, tablet, desktop

### Performance Best Practices

1. **Images:**
   - Use WebP format when possible
   - Optimize images before adding to `public/`
   - Use appropriate sizes (don't serve 4K images for thumbnails)
   - Consider lazy loading with `loading="lazy"`

2. **JavaScript:**
   - Minimize React islands
   - Use `client:visible` for below-the-fold components
   - Use `client:idle` for non-critical interactive elements
   - Keep bundle sizes small

3. **CSS:**
   - Use Tailwind utilities to leverage PurgeCSS
   - Avoid large custom stylesheets
   - Use scoped styles for component-specific CSS
   - Minimize animation complexity

4. **Content:**
   - Keep markdown files reasonable in size
   - Use content collections for type safety
   - Leverage Astro's static generation
   - Minimize API calls at build time

### Accessibility Checklist

- [ ] Semantic HTML elements used appropriately
- [ ] All images have descriptive `alt` attributes
- [ ] Color contrast meets WCAG AA standards
- [ ] Interactive elements are keyboard accessible
- [ ] Forms have proper labels
- [ ] ARIA attributes used when semantic HTML isn't enough
- [ ] Focus states are visible
- [ ] Motion animations respect `prefers-reduced-motion`
- [ ] Headings follow logical hierarchy (h1 → h2 → h3)
- [ ] Links have descriptive text (avoid "click here")

### Git Workflow

**Trunk-based development.** `master` is the trunk; branches are short-lived
and **rebased** onto it.

> **Rebase feature branches onto `master`. Never merge `master` into a
> feature branch.** Merge commits obscure history and topology.

```bash
git fetch origin master
git rebase origin/master
git push --force-with-lease      # never plain --force
```

Merge commits are disabled on the repository — land PRs with squash or
rebase merge.

This is not only aesthetic: `pull_request` workflows run the workflow file
from **the PR's own branch**, so a branch cut before a pipeline fix keeps
running the broken pipeline until it is rebased. If a PR fails in a way that
looks environmental, rebase before investigating.

1. **Branches:** `type/short-description` — `feat/`, `fix/`, `ci/`, `docs/`,
   `test/`, `content/`. Keep unrelated work on separate branches.
2. **Commits:** imperative subject, then the *why* in the body.
   - Good: "add dark mode toggle to navigation"
   - Bad: "fix stuff"
3. **Before pushing:** `yarn ci` (check, lint, test, build) must be green.

See `docs/WORKFLOW.md` for the full convention.

---

## Troubleshooting

### Common Issues

**Issue:** Tailwind classes not applying
- **Solution:** Tailwind 4 auto-detects content — restart the dev server after
  editing `@theme` in `global.css`
- **Solution:** In a component's scoped `<style>`, add
  `@reference "../styles/global.css";` before using `@apply`

**Issue:** TypeScript errors in `.astro` files
- **Solution:** Run `nx check web-astro` for detailed errors
- **Solution:** Ensure props interface is correctly defined

**Issue:** Dark mode not persisting
- **Solution:** Check localStorage in browser DevTools
- **Solution:** Verify `is:inline` script in `Layout.astro`

**Issue:** Content collection changes not reflected
- **Solution:** Restart dev server
- **Solution:** Check schema/loaders in `src/content.config.ts`

**Issue:** Build fails with "Cannot find module"
- **Solution:** Check path aliases in `packages/web-astro/tsconfig.json`
- **Solution:** Ensure imports use correct aliases

**Issue:** Nx cache causing stale builds
- **Solution:** Run `nx reset` to clear cache
- **Solution:** Use `--skip-nx-cache` flag

---

## Additional Resources

- **Astro Docs:** https://docs.astro.build
- **Tailwind CSS Docs:** https://tailwindcss.com/docs
- **Nx Docs:** https://nx.dev
- **TypeScript Docs:** https://www.typescriptlang.org/docs
- **Cloudflare Workers Docs:** https://developers.cloudflare.com/workers

---

## Maintenance Notes

### Known TODOs
- Connect blog to Medium/Substack integration
- Complete AI Resume functionality (state sharing with nanostores)
- Implement E2E test coverage
- Optimize Lighthouse scores
- Add mobile app version
- Create portfolio analytics dashboard

### Recent Changes
- **Major stack upgrade (July 2026):** Node 18→22, TypeScript 5.4→5.7,
  Nx 19→23, Astro 4→7 (+ Content Layer), React 18→19, Tailwind 3→4
  (CSS-first), ESLint 8→9 (flat config), Prettier 2→3.
- Removed the abandoned `@nxtensions/astro` plugin; Astro CLI now runs via
  Nx `run-commands`.
- Added a Vitest test suite, GitHub Actions CI + Cloudflare deploy workflows.
- Removed the committed Nx Cloud token from `nx.json` (**it was a plaintext
  read-write token and should be rotated**); Nx now uses local caching.
- Build output moved to `packages/web-astro/dist` (workerd sandbox
  constraint).

---

**Last Updated:** 2026-07-25
**Maintainer:** Eddie Freeman
**For Questions:** Refer to README.md or codebase comments
