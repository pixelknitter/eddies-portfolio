// https://docs.astro.build/en/guides/environment-variables/
export const isProd = import.meta.env.PROD;
export const isDev = import.meta.env.DEV;
export const baseURL = import.meta.env.BASE_URL;
export const openaiToken = import.meta.env.OPEN_AI_TOKEN;

export const iconUrl = 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons'

export const buildingBlocks: Record<BlockCategory, Badge[]> = {
  'Languages': [
      { label: "TypeScript", tech: "typescript" },
      { label: "JavaScript", tech: "javascript" },
      { label: "CSS", tech: "css3" },
      { label: "HTML", tech: "html5" },
      { label: "Kotlin", tech: "kotlin" },
      { label: "Swift", tech: "swift" },
      { label: "Python", tech: "python" },
      { label: "Bash", tech: "bash" }
  ],
  'Frameworks': [
      { label: "React", tech: "react" },
      { label: "NextJS", tech: "nextjs" },
      { label: "Astro", tech: "astro" },
      { label: "Tailwind", tech: "tailwindcss" },
      { label: "Jamstack", tech: "jamstack" }
  ],
  'Platforms': [
      { label: "OpenAI", tech: "openai", src: "https://www.cdnlogo.com/logos/o/38/openai.svg" },
      { label: "Android", tech: "android" },
      { label: "iOS", tech: "apple" },
      { label: "Expo", tech: "expo", src: "/expo.svg" }
  ],
  'Tools': [
      { label: "Jest", tech: "jest", iconSuffix: 'plain'},
      { label: "Gradle", tech: "gradle" },
      { label: "Mobx", tech: "mobx" },
      { label: "Sanity", tech: "sanity" },
      { label: "Storybook", tech: "storybook" },
      { label: "Figma", tech: "figma" },
      { label: "VSCode", tech: "vscode" },
      { label: "Yarn", tech: "yarn" },
      { label: "Git", tech: "git" }
  ],
  'Infrastructure': [
      { label: "Cloudflare", tech: "cloudflare" },
      { label: "Vercel", tech: "vercel" },
      { label: "Amazon Web Services", tech: "amazonwebservices", iconSuffix: 'original-wordmark' },
      { label: "PostgreSQL", tech: "postgresql" },
      { label: "GitHub", tech: "github" },
      { label: "GitHub Actions", tech: "githubactions" },
      { label: "Drop Wizard", tech: "dropwizard" }
  ],
  'Analytics': [
      { label: "Sentry", tech: "sentry" },
      { label: "Open Telemetry", tech: "opentelemetry" }
  ]
};