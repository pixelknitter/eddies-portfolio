# CLAUDE.md - AI Assistant Guide for Eddie's Portfolio

> **Version:** 0.3.0
> **Last Updated:** 2025-11-23
> **Purpose:** This document provides comprehensive guidance for AI assistants working with Eddie Freeman's portfolio codebase.

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
A professional portfolio website showcasing Eddie's work, blog posts, projects, and skills. The site features a modern design with dark/light theme support, interactive components, and optimized performance for Cloudflare Pages deployment.

### Key Features
- Personal about section with skills/tech stack display
- Blog with markdown content (draft support)
- Project showcase with detailed case studies
- AI Resume interactive component (in development)
- Dark/light theme with persistence and cross-tab sync
- Responsive design with mobile-first approach
- Server-side rendering on Cloudflare Pages

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
├── content/               # Content collections (typed)
│   ├── config.ts          # Zod schemas for collections
│   ├── blog/              # Blog markdown files
│   ├── projects/          # Project markdown files
│   └── authors/           # Author data (JSON)
│
├── react/                 # React components (islands)
│   └── AIResume.tsx       # Interactive AI resume
│
├── static/                # Static markdown files
│   └── about.md           # Home page about content
│
├── styles/
│   └── global.css         # Global Tailwind styles
│
└── util/
    └── constants.ts       # Environment vars, tech stack data
```

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
- **Astro 4.13.1** - Static site generator with server output for Cloudflare
- **React 18.3.1** - For interactive islands (minimal client-side JS)
- **TypeScript 5.4.5** - Strict mode enabled

### Styling
- **Tailwind CSS 3.4.3** - Utility-first CSS framework
- **@tailwindcss/typography** - Styled prose content
- **PostCSS** - CSS transformations
- **Autoprefixer** - Vendor prefix automation

### Build Tools
- **Nx 19.0.3** - Monorepo build system with smart caching
- **@nxtensions/astro** - Nx integration for Astro
- **Yarn 3.8.2** - Package manager (node-modules linker)

### Testing
- **Cypress 12.17.4** - E2E testing
- **Jest** - Unit/integration testing (Nx preset)

### Code Quality
- **ESLint 8.57.0** - Linting (TypeScript, React, Astro plugins)
- **Prettier 2.6.2** - Code formatting with Tailwind class sorting

### Deployment
- **@astrojs/cloudflare** - Cloudflare Pages adapter
- **Nx Cloud** - Remote caching for CI/CD

---

## Development Workflows

### Prerequisites

```bash
# Required Node version
node --version  # Should be v18.19.0 (see .nvmrc)

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

# Run E2E tests
nx e2e web-astro-e2e
```

### Nx Caching

Nx caches build outputs, lint results, and test runs for faster rebuilds:
- Cache location: `node_modules/.cache/nx`
- Remote caching: Nx Cloud (enabled)
- Clear cache: `nx reset`

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

Content is typed using Zod schemas in `src/content/config.ts`:

```typescript
import { defineCollection, z, reference } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    author: reference('authors'),
    relatedPosts: z.array(z.string()).optional(),
    tags: z.array(z.string()),
    draft: z.boolean().default(false),
    heroImage: z.string().optional(),
  }),
});
```

**Querying content:**

```typescript
import { getCollection } from 'astro:content';

// Get all blog posts (filtering drafts in production)
const posts = await getCollection('blog', ({ data }) => {
  return import.meta.env.PROD ? !data.draft : true;
});

// Get single entry
const project = await getEntry('projects', 'project-1');
```

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

Three collections defined in `src/content/config.ts`:

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

### Tailwind Configuration

**Location:** `packages/web-astro/tailwind.config.cjs`

#### Custom Colors

```javascript
colors: {
  dark: '#1e1e2e',      // Dark mode background
  light: '#fdebf3',     // Light mode background
  button: '#5dd39e',    // Primary button color
  link: '#5dd39e',      // Link color
  underline: '#348aa7', // Underline accent
  emphasis: '#525174',  // Text emphasis
  tag: '#584966',       // Tag background
  disabled: '#5c5b77',  // Disabled state
}
```

#### Custom Fonts

```javascript
fontFamily: {
  head: ['Pacifico', 'cursive'],          // Headers
  body: ['Josefin Sans', 'sans-serif'],   // Body text
}
```

#### Custom Animations

```javascript
keyframes: {
  fadeIn: { /* ... */ },
  slideUp: { /* ... */ },
  bounce: { /* ... */ },
}
```

### Dark Mode Implementation

**Class-based dark mode** with localStorage persistence:

```javascript
// In Layout.astro
<script is:inline>
  // Check localStorage or system preference
  const theme = localStorage.getItem('theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  }
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

### E2E Testing with Cypress

**Location:** `packages/web-astro-e2e/`

**Run tests:**
```bash
nx e2e web-astro-e2e
nx e2e web-astro-e2e --watch  # Interactive mode
```

**Test structure:**
```typescript
// src/e2e/app.cy.ts
describe('web-astro', () => {
  beforeEach(() => cy.visit('/'));

  it('should display welcome message', () => {
    cy.get('h1').should('contain', 'Welcome');
  });
});
```

**Page Object Model:**
```typescript
// src/support/app.po.ts
export const getGreeting = () => cy.get('h1');
```

### Unit Testing with Jest

**Configuration:** `jest.config.ts`

**Run tests:**
```bash
nx test web-astro
nx test web-astro --watch
```

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

### Cloudflare Pages

**Adapter:** `@astrojs/cloudflare`
**Output Mode:** Server (SSR enabled)
**Build Output:** `dist/packages/web-astro/`

**Astro configuration:**
```javascript
// astro.config.mjs
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  // ...
});
```

### Build Process

```bash
# Build for production
yarn astro:build

# Output location
dist/packages/web-astro/
```

### Environment Variables

Define in Cloudflare Pages dashboard or `.env`:

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

1. Edit `tailwind.config.cjs`:
```javascript
theme: {
  extend: {
    colors: {
      primary: '#new-color',
    },
  },
}
```

2. Use in components:
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

1. **Branches:** Work on feature branches (e.g., `claude/feature-name`)
2. **Commits:** Use descriptive commit messages
   - Good: "add dark mode toggle to navigation"
   - Bad: "fix stuff"
3. **Testing:** Run `nx affected:test` before pushing
4. **Linting:** Run `nx affected:lint` before committing
5. **Type checking:** Run `nx check web-astro` before pushing

---

## Troubleshooting

### Common Issues

**Issue:** Tailwind classes not applying
- **Solution:** Check `tailwind.config.cjs` content paths include your files
- **Solution:** Restart dev server after config changes

**Issue:** TypeScript errors in `.astro` files
- **Solution:** Run `nx check web-astro` for detailed errors
- **Solution:** Ensure props interface is correctly defined

**Issue:** Dark mode not persisting
- **Solution:** Check localStorage in browser DevTools
- **Solution:** Verify `is:inline` script in `Layout.astro`

**Issue:** Content collection changes not reflected
- **Solution:** Restart dev server
- **Solution:** Check schema in `src/content/config.ts`

**Issue:** Build fails with "Cannot find module"
- **Solution:** Check path aliases in `tsconfig.base.json`
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
- **Cloudflare Pages Docs:** https://developers.cloudflare.com/pages

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
- Navigation feature flagging (under development)
- Footer spacing adjustments
- Typo fixes in content (Entrepreneur badge)
- Tailwind CSS migration from global styles
- React dependency fixes
- Content typing improvements

---

**Last Updated:** 2025-11-23
**Maintainer:** Eddie Freeman
**For Questions:** Refer to README.md or codebase comments
