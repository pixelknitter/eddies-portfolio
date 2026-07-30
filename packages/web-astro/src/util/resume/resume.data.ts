/**
 * The resume, as data.
 *
 * Five surfaces render from this module: the collapsed visual page at
 * `/air/resume/`, the complete machine-oriented page at `/air/resume/for-bots`,
 * the JSON-LD graph that page carries, and the two print routes the PDF
 * generator prints. They must agree, so there is exactly one copy of the prose.
 *
 * ## Why a module and not a content collection
 *
 * Collections earn their keep when content is plural — a loader, a schema and a
 * glob pay for themselves across many entries (see `content.config.ts`, where
 * every collection genuinely is). There is one resume. A typed module gives
 * stronger guarantees for less machinery: the shape is checked at build time
 * rather than parse time, and the visual page can map straight over it.
 *
 * ## Contact details are deliberately absent
 *
 * `RESUME` contains no email address and no phone number. That is the feature,
 * not an omission — the visible resume routes visitors through the request flow
 * instead of publishing an inbox, and `resume.data.spec.ts` asserts it by
 * pattern so a well-meaning edit cannot quietly undo it.
 *
 * The PDF and print surfaces do need a contact block, so it lives in a separate
 * `CONTACT` export that only those routes import. Two exports rather than an
 * `includeContact` flag: a flag would put the decision at every call site, and
 * getting it wrong once publishes the address.
 *
 * ## Prose formatting
 *
 * Bullets and summaries may contain `**bold**` markers, converted by
 * `emphasize()` in `./markup.ts`. No HTML in here — see that module for why.
 *
 * ## Source of truth
 *
 * Transcribed from the Claude Design project "Website resume designs"
 * (`Resume.dc.html`): variant **2a** for the visual page's structure and
 * condensed wording, variant **1a** for the complete bullet set. The
 * `Resume_Content_A_Ready.md` upload in that project is **superseded** and must
 * not be used — it predates these edits and carries private interview notes.
 */

/** A stat tile on the visual resume. */
export interface ResumeStat {
  value: string;
  label: string;
}

/** A named strength, rendered as a card. */
export interface ResumeStrength {
  title: string;
  detail: string;
  /** Spans both grid columns. Used for the one entry that needs the room. */
  wide?: boolean;
}

/**
 * A single achievement line.
 *
 * `featured` marks the subset the visual page shows. The complete set always
 * renders on `/air/resume/for-bots` and in the PDFs, so nothing is lost —
 * the flag controls emphasis, not inclusion.
 */
export interface ResumeBullet {
  text: string;
  featured?: boolean;
}

/** A highlighted outcome, rendered as a card with a large value. */
export interface ResumeHighlight {
  value: string;
  detail: string;
}

/** Which section of the visual resume a role appears in. */
export type ResumeTier = 'selected' | 'earlier';

export interface ResumeRole {
  org: string;
  role: string;
  location: string;
  /** Human-facing span, e.g. "Feb 2023 – Jul 2026". */
  dates: string;
  /**
   * Machine-readable bounds, ISO 8601 year-month. These exist for the JSON-LD
   * graph: a generative engine can order and date a career from `2023-02` but
   * has to guess at "Feb 2023 – Jul 2026". `end` is absent for current roles,
   * which is what marks them current.
   */
  start: string;
  end?: string;
  /** Short label for the "Earlier career" grid, e.g. "2018 – 2019". */
  period?: string;
  /** Scene-setting line, italicised. From variant 1a. */
  lede?: string;
  /** Condensed opening paragraph for the visual page. From variant 2a. */
  summary?: string;
  /** One-line form used by the visual "Earlier career" grid. */
  compact?: string;
  tags?: string[];
  highlights?: ResumeHighlight[];
  bullets: ResumeBullet[];
  tier: ResumeTier;
}

export interface ResumeSkillGroup {
  group: string;
  /** Maps to organic's tag-accent / tag-accent-2 / tag-neutral classes. */
  tone: 'accent' | 'accent-2' | 'neutral';
  items: string[];
}

export interface ResumeTalk {
  org: string;
  title: string;
  url: string;
  detail: string;
}

export interface ResumeEducation {
  period: string;
  institution: string;
  detail: string;
}

/**
 * How many engineers were interviewed for G2i.
 *
 * The design left this as an unresolved `{{ engineerCount }}` placeholder. It is
 * named here rather than inlined because it appears in three places (a stat
 * tile, a core strength, and the speaking section) and they must not disagree.
 */
export const ENGINEER_COUNT = '~100';

/**
 * Whether to mention running Inkitt's hiring loop.
 *
 * The design gated this sentence behind a `{{ showInkittInterview }}`
 * conditional, i.e. it was authored as optional. Off by default: the Inkitt
 * tenure was short and the speaking section reads stronger without a third
 * qualifier in the same sentence. Flip to `true` to include it.
 */
export const SHOW_INKITT_INTERVIEW = false;

export const RESUME = {
  name: 'Eddie Freeman',
  headline: 'Senior Product Engineer · AI-Native · Agentic Systems',
  location: 'Portland, OR',

  /** Condensed, for the visual page. Variant 2a. */
  summary:
    '15+ years shipping production systems. I work at the seams between disciplines — carrying design intent into implementation, building platform capability other teams ship on, and taking ownership of the operational layer when it needs an owner.',

  /** Complete, for the machine page and the PDFs. Variant 1a. */
  longSummary:
    '15+ years shipping production systems across consumer mobile apps, cross-platform SDKs, and agentic AI. I work at the seams between disciplines — carrying design intent into implementation, building platform capability other teams ship on, and taking ownership of the operational layer when it needs an owner. Currently architect and operator of a multi-agent operations platform — **17 agents in production** of 27 registered — running a live business end to end. Accessibility-first practice, with particular focus on cognitive accessibility.',

  stats: [
    {
      value: '17',
      label:
        'agents in production, of 27 registered — the rest sub-agents the active ones invoke',
    },
    { value: '1M+', label: 'downloads on mobile apps powered by SDKs I built' },
    {
      value: ENGINEER_COUNT,
      label: 'engineers interviewed for a vetted talent network',
    },
    {
      value: '15+',
      label: 'years across consumer mobile, SDKs, and agentic AI',
    },
  ] satisfies ResumeStat[],

  strengths: [
    {
      title: 'Design ↔ engineering translation',
      detail:
        'Trusted to carry intent, not specs. Automated design-conformance checks against Figma tokens.',
    },
    {
      title: 'Platform capability',
      detail:
        'Founded a React Native practice; SDKs adopted across business units; a live multi-agent operations platform in four months.',
    },
    {
      title: 'Operational ownership',
      detail:
        'CI/CD, observability, deployment enablement, runbooks, payroll compliance auditing.',
    },
    {
      title: 'Accessibility-first practice',
      detail:
        'Cognitive accessibility in particular — built a BI layer a dyslexic owner actually uses.',
    },
    {
      title: 'Partner & vendor development',
      detail:
        'EAP agreements and executive relationships that turn a platform vendor into a roadmap channel — early technology access and genuine influence on what ships.',
      wide: true,
    },
  ] satisfies ResumeStrength[],

  now: {
    org: 'Simply Build / Your Curlfriend',
    role: 'Co-Owner & Platform Engineer',
    location: 'Portland, OR',
    dates: 'Aug 2025 – Present',
    start: '2025-08',
    lede: 'Co-own a curl-specialty salon with my wife, who operates the business; I lead the technical and operational side and build supporting technical solutions to real business problems.',
    summary:
      'I architected and operate a **multi-agent operations platform that runs a live salon end to end** — built from scratch beginning April 2026, coordinating through event-driven messaging with a Registry Manager as service registry and control plane.',
    tags: [
      'finance',
      'payroll',
      'client intake',
      'retail',
      'content',
      'hiring',
      'concierge',
    ],
    highlights: [
      {
        value: '1 hr → 10–30 min',
        detail:
          'Weekly payroll effort, via an audit agent encoding Oregon labor rules — catches a real compliance discrepancy roughly every two weeks.',
      },
      {
        value: 'Square → Mangomint',
        detail:
          'Booking and POS migrated with no material disruption to live operations, establishing the data feed the BI and agent layers run on.',
      },
      {
        value: 'Early technology access',
        detail:
          'EAP agreements with Mangomint, plus regular conversations with their business leaders about platform gaps. Webhooks I can name; the rest is under NDA.',
      },
    ],
    bullets: [
      {
        text: 'Architected and operate a **multi-agent operations platform — 17 agents in production, 27 registered** (the remainder sub-agents the active ones invoke) — spanning finance, payroll, client intake, retail, content, hiring, and concierge, coordinating through event-driven messaging with a Registry Manager serving as service registry and control plane. Built from scratch beginning April 2026.',
      },
      {
        text: 'Built a **centralized observability plane with severity-based routing** and human-in-the-loop escalation; approval-first gating on every outbound client- and employee-facing action.',
        featured: true,
      },
      {
        text: 'Built a **payroll audit agent** encoding Oregon hourly labor rules with private staff confirmation loops — **cut payroll effort from ~1 hour to 10–30 minutes weekly**, catching a real compliance discrepancy roughly every two weeks before each run finalizes.',
      },
      {
        text: 'Designed the **BI layer around cognitive accessibility** for a co-owner with dyslexia: visual-first metrics, inline targets, and every figure paired with a concrete next action — moving the business from avoided spreadsheets to data-driven decisions.',
        featured: true,
      },
      {
        text: '**Leading migration off a hosted agent platform to self-owned infrastructure** for architectural control and unit-cost visibility, re-partitioning deterministic workflows out of the agentic runtime and reserving agents for work that genuinely requires reasoning.',
        featured: true,
      },
      {
        text: 'Migrated booking and POS from **Square to Mangomint with no material disruption** to live operations, establishing the structured data feed powering the BI and agent layers.',
      },
      {
        text: 'Own the technical-partner side of the business — **EAP agreements and working relationships with platform vendors**. Regular conversations with Mangomint’s business leaders about gaps in their platform have earned **early access to new technology** — webhooks I can name publicly, plus further features under NDA — real weight when requesting features, and a direct channel for business needs.',
        featured: true,
      },
    ],
    tier: 'selected',
  } satisfies ResumeRole,

  experience: [
    {
      org: 'Frontdoor (Streem)',
      role: 'Senior Software Engineer',
      location: 'Portland, OR',
      dates: 'Feb 2023 – Jul 2026',
      start: '2023-02',
      end: '2026-07',
      summary:
        'Founded the React Native initiative and architected **2 cross-platform video-conference SDKs adopted across 2 business units**, powering live expert video calls in apps with **1M+ downloads and near-5-star ratings**.',
      bullets: [
        {
          text: 'Founded the React Native initiative; architected **2 cross-platform video-conference SDKs adopted across 2 business units**, powering live expert video calls in mobile apps with **1M+ downloads and near-5-star ratings**; carried the integration into the AHS mobile app through a manager transition, delivering on schedule.',
        },
        {
          text: 'Led the **Twilio → Amazon Chime video migration ahead of vendor sunset**, enabled by an adapter pattern designed into the SDK up front; wrapped native SDKs in an Expo module with Kotlin and Swift platform implementations.',
          featured: true,
        },
        {
          text: 'Prototyped **design-conformance automation** pulling Figma design tokens to verify implementation matched design, catching color and spacing mismatches during build rather than in late review; **presented to executive leadership including the incoming CTO and earned a seat on the AI Champions team**.',
          featured: true,
        },
        {
          text: '**Removed an AWS Parameter Store dependency from mobile CI** by uploading build metadata directly to the test framework — eliminating the AWS CLI from pipelines, reducing build and setup/teardown time, shrinking the credential surface, and simplifying the GitHub → GitLab migration.',
          featured: true,
        },
        {
          text: 'Diagnosed **delivery flow — not pipeline speed — as the constraint** on the contractor portal, where finished work sat undeployed in lost branches; drove adoption of trunk-based development with preview environments and expanded test coverage.',
          featured: true,
        },
        {
          text: 'Established operational-excellence practice: **container-as-a-service deployment enablement** unused for years prior, **runbooks replacing tribal knowledge** and meeting-based handoffs, app-to-SDK observability traceability, and maintainability patterns for LLM, React Native, and web operations.',
          featured: true,
        },
      ],
      tier: 'selected',
    },
    {
      org: 'Eight Sleep',
      role: 'Software Engineer',
      location: 'Portland, OR',
      dates: 'Jan 2021 – May 2022',
      start: '2021-01',
      end: '2022-05',
      summary:
        'Led a React Native team of 3–5 on the smart-bed companion app handling sensitive health data — **release confidence ~20% → ~80%**, **99.2% median app stability**.',
      bullets: [
        {
          text: 'Led a React Native team of 3–5 building the smart-bed companion app handling sensitive health data.',
        },
        {
          text: 'Replaced ill-fitting crash and analytics tooling with **Embrace** for first-class React Native support; standardized logging practice and built automated data-injection pipelines into Kustomer for customer support.',
          featured: true,
        },
        {
          text: 'Defined an **impact-vs-severity triage framework** pairing performance and customer-inbound signals with a product-owner on-call cycle — shifting incident response from reactive firefighting to prioritized, data-backed decisions. Improved team burn-down **~22%**.',
          featured: true,
        },
        {
          text: 'Built a CI/CD pipeline with automated testing, **raising release confidence from ~20% to ~80%**; maintained **99.2% median app stability**; coordinated a core team plus rotating contractors across time zones.',
        },
      ],
      tier: 'selected',
    },
    {
      org: 'Wandering Hearth Studio',
      role: 'Founder & Principal Consultant',
      location: 'Portland, OR',
      dates: '2015 – Present',
      start: '2015-01',
      lede: 'Concurrent with employment. Independent consulting on developer experience, sustainable process, and cross-platform architecture. Clients and collaborations include Eight Sleep, Kamino Care, StackPath, Flapdo, and an early-stage AI startup.',
      summary:
        'Consulting on developer experience, sustainable process, and cross-platform architecture — concurrent with employment. Led 5 interns with minimal mobile experience to a **full-stack React Native MVP** inside a 5-week accelerator.',
      tags: [
        'Eight Sleep',
        'Kamino Care',
        'StackPath',
        'Flapdo',
        'Early-stage AI startup',
      ],
      bullets: [
        {
          text: 'Led 5 interns with minimal mobile experience to deliver a **full-stack React Native MVP** — serverless backend, user creation, appointment booking — inside a 5-week accelerator program.',
          featured: true,
        },
      ],
      tier: 'selected',
    },
    {
      org: 'Inkitt',
      role: 'Senior Frontend Engineer',
      location: 'Remote',
      dates: 'Aug 2022 – Jan 2023',
      start: '2022-08',
      end: '2023-01',
      period: '2022 – 2023',
      compact:
        '**Inkitt** — Senior Frontend Engineer. Resolved an architectural flaw destabilizing CodePush OTA releases; built a proposal system that made technical direction visible across time zones.',
      bullets: [
        {
          text: 'Diagnosed and resolved an architectural flaw destabilizing CodePush over-the-air releases.',
        },
        {
          text: 'Prototyped an optimized release pipeline supporting multiple concurrent releases with reduced overhead.',
        },
        {
          text: 'Drove code-quality initiatives through a proposal system that made technical direction visible across time zones.',
        },
      ],
      tier: 'earlier',
    },
    {
      org: 'Infinite Red (uShip)',
      role: 'Freelance Software Engineer',
      location: 'Remote',
      dates: 'Feb – Jul 2019',
      start: '2019-02',
      end: '2019-07',
      period: '2019',
      compact:
        '**Infinite Red (uShip)** — Freelance Software Engineer. **~24% code-smell reduction**, **~15% fewer** remote-handling error reports, 2 major features with a core team of 3.',
      bullets: [
        {
          text: 'Refactored for readability and maintainability (**~24% code-smell reduction**); **reduced remote-handling error reports ~15%**; launched **2 major features** with a core team of 3.',
        },
      ],
      tier: 'earlier',
    },
    {
      org: 'Apex Systems (Nike)',
      role: 'Lead Software Engineer',
      location: 'Portland, OR',
      dates: 'Feb 2018 – Jan 2019',
      start: '2018-02',
      end: '2019-01',
      period: '2018 – 2019',
      compact:
        '**Apex Systems (Nike)** — Lead Software Engineer. Grew a secure internal React/React Native product catalog **from a two-week MVP into a shared-code platform other Nike teams sought to join**, with a data model adopted as the org’s single source of truth.',
      bullets: [
        {
          text: 'Architected a secure internal cross-platform React/React Native product catalog, growing it **from a two-week MVP into a shared-code platform other Nike teams sought to join** — MVVM with a Facade pattern, unified build pipeline, OKTA integration, and a data model adopted as the organization’s single source of truth.',
        },
      ],
      tier: 'earlier',
    },
    {
      org: 'Ticketfly / Eventbrite',
      role: 'Mobile Engineer (iOS) · Editor-in-Chief',
      location: 'San Francisco, CA',
      dates: 'Jan 2016 – Dec 2017',
      start: '2016-01',
      end: '2017-12',
      period: '2016 – 2017',
      lede: 'Launched two consumer applications with 500k–1M+ MAU and five-star ratings.',
      compact:
        '**Ticketfly / Eventbrite** — Mobile Engineer (iOS) · Editor-in-Chief. Two consumer apps at **500k–1M+ MAU**; cut event-search lookups **from seconds to milliseconds**; used traffic data to unstick a stalled decision, then **led 12 engineers to a Kotlin MVP in a 3-day hackathon**.',
      bullets: [
        {
          text: 'Diagnosed event-search latency by benchmarking client, Elasticsearch, and data services independently; designed a purpose-built minimal search table that **cut lookups from seconds to milliseconds**.',
        },
        {
          text: 'Used customer data (**50%+ of mobile-web traffic on Android**) to unstick a stalled business decision, then **led 12 engineers to a Kotlin MVP in a 3-day hackathon** — moving leadership from “should we build this?” to “how fast can it ship?”',
        },
        {
          text: 'Automated QA with Rainforest QA, **cutting process time ~50%** and eliminating half-day manual test sessions.',
        },
      ],
      tier: 'earlier',
    },
    {
      org: 'Crittercism / Apteligent',
      role: 'Senior Developer Success Engineer',
      location: 'San Francisco, CA',
      dates: 'Jun 2012 – Nov 2014',
      start: '2012-06',
      end: '2014-11',
      period: '2012 – 2014',
      compact:
        '**Crittercism / Apteligent** — Senior Developer Success Engineer. Employee #8 through **12x growth to 100+**, supporting ~10,000 developers; built Unity and Appcelerator plugins; a knowledge repository that **cut repetitive inquiries ~65%**.',
      bullets: [
        {
          text: 'Employee #8 through **12x growth to 100+**, supporting **~10,000 developers**; built **Unity and Appcelerator plugins** extending platform reach to cross-platform development environments.',
        },
        {
          text: 'Created an in-product knowledge repository that **cut repetitive client inquiries ~65%** and **improved support SLA by 3 days**.',
        },
      ],
      tier: 'earlier',
    },
  ] satisfies ResumeRole[],

  /**
   * The pre-2012 roles, too old to carry bullets but worth naming. Rendered as
   * the final row of the "Earlier career" grid and as a closing line on the
   * machine page.
   */
  earliest:
    'Technology Evangelist, **ngmoco/DeNA** (mobile gaming & social platform) · Software Engineer, **Noblis** (healthcare & government).',

  skills: [
    {
      group: 'AI & agentic systems',
      tone: 'accent',
      items: [
        'Multi-agent architecture',
        'Event-driven orchestration',
        'Control-plane design',
        'Agent observability',
        'Human-in-the-loop gating',
        'Claude API',
        'MCP',
        'LLM evaluation',
      ],
    },
    {
      group: 'Languages, frontend & mobile',
      tone: 'neutral',
      items: [
        'TypeScript',
        'JavaScript',
        'Python',
        'Kotlin',
        'Swift',
        'React',
        'React Native',
        'Expo',
        'Next.js',
        'Cross-platform SDKs',
      ],
    },
    {
      group: 'Backend, infrastructure & observability',
      tone: 'neutral',
      items: [
        'Node.js',
        'AWS',
        'Cloudflare Workers',
        'Postgres',
        'Firebase',
        'GitHub Actions',
        'GitLab CI',
        'Datadog',
        'Embrace',
        'Langfuse',
      ],
    },
    {
      group: 'Practice',
      tone: 'accent-2',
      items: [
        'Accessibility-first design',
        'Cognitive accessibility',
        'Trunk-based development',
        'E2E & integration testing',
        'Technical mentorship',
      ],
    },
  ] satisfies ResumeSkillGroup[],

  speaking: {
    evaluation: `Interviewed **${ENGINEER_COUNT} engineers** for **G2i**, a vetted developer talent network, and served on the hiring committee that staffed Frontdoor’s AHS mobile team.${
      SHOW_INKITT_INTERVIEW
        ? ' Also ran engineering interviews for Inkitt’s hiring loop.'
        : ''
    }`,
    talks: [
      {
        org: 'G2i',
        title: 'Leveraging AI to Keep Up with the Evolving AI Landscape',
        url: 'https://youtu.be/LIKheulPiQ0',
        detail:
          'AI-Powered Development Series, Part 1 — building a sustainable system to adopt AI developments without burning out.',
      },
      {
        org: 'The Tech Academy',
        title: 'Boost Your Productivity with AI-Powered Workflows',
        url: 'https://youtu.be/p2nCevgEfEo',
        detail: 'Hour-long Tech Talk, September 2025.',
      },
    ] satisfies ResumeTalk[],
    footer:
      'Also a commissioned private engagement for business owners on AI workflows (2025), and internal Frontdoor sessions on AI engineering, agentic and multi-agent systems, debugging practice, and documentation standards.',
    writing: {
      label: 'thebetween.space',
      url: 'https://thebetween.space',
      detail: 'on technology, culture, and the space between',
    },
  },

  education: [
    {
      period: '2004 – 2009',
      institution: 'California Polytechnic State University, San Luis Obispo',
      detail:
        'Computer Engineering. Embedded systems, circuit design, software systems, and early AI reasoning; coursework emphases in Philosophy and Psychology.',
    },
    {
      period: 'Continued',
      institution: 'Berkeley City College',
      detail: 'Creative Writing and electives.',
    },
  ] satisfies ResumeEducation[],
} as const;

/**
 * Contact details, for print and PDF surfaces **only**.
 *
 * Never import this into a route that renders to the public web. The visible
 * resume deliberately publishes no address; `/air/resume/` sends visitors
 * through the request form instead, and that is the whole basis of the
 * lead-capture gate.
 *
 * `connect@` rather than the `eddie@` the source design used: `connect@` is the
 * address already published in the site footer and the one the A.I.R. approval
 * mail sends from, so a PDF pointing anywhere else would fragment the inbox.
 *
 * No phone number, by decision — a number in a PDF travels with every forward
 * of the file and cannot be un-shared.
 */
export const CONTACT = {
  email: 'connect@eddie.engineering',
  site: 'eddie.engineering',
  siteUrl: 'https://eddie.engineering',
  linkedin: 'linkedin.com/in/eddiefreeman',
  linkedinUrl: 'https://linkedin.com/in/eddiefreeman',
  github: 'github.com/pixelknitter',
  githubUrl: 'https://github.com/pixelknitter',
} as const;

/**
 * Every role, most recent first.
 *
 * `RESUME.experience` is ordered for the *visual* page: selected roles first,
 * then the "Earlier career" grid. That grouping puts Wandering Hearth
 * (2015 – Present, held concurrently with employment) between Eight Sleep and
 * Inkitt, which reads fine under a heading that explains it and reads as
 * scrambled to anything consuming the list linearly.
 *
 * So the complete document and the JSON-LD graph both order by start date
 * descending, which is what a reader — human or machine — expects of a career.
 * Concurrent roles still interleave by when they began; that is accurate.
 */
export function rolesByRecency(): ResumeRole[] {
  const roles: ResumeRole[] = [RESUME.now, ...RESUME.experience];
  return roles.sort((a, b) => b.start.localeCompare(a.start));
}

/** Where the visible resume sends people instead of publishing an address. */
export const REQUEST_PATH = '/air/resume/';

/**
 * Route prefix for every resume surface.
 *
 * `Footer.astro` matches on this to swap its `mailto:` for a link to the request
 * form. Derived from the path rather than passed as a prop deliberately: a prop
 * has to be remembered on each new resume route, and forgetting it silently
 * republishes the address on the one page whose whole premise is that it does
 * not. A route match cannot be forgotten.
 */
export const RESUME_ROUTE_PREFIX = '/air/resume';

/**
 * Whether a pathname belongs to a resume surface, and should therefore route
 * contact through the request form instead of exposing an address.
 */
export function isResumeRoute(pathname: string): boolean {
  return (
    pathname === RESUME_ROUTE_PREFIX ||
    pathname.startsWith(`${RESUME_ROUTE_PREFIX}/`)
  );
}

export type Resume = typeof RESUME;
