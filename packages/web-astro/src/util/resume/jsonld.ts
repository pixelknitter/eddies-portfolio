import { rolesByRecency, type ResumeRole } from './resume.data';
import type { Resume } from './load';
import { plainText } from './markup';

/**
 * The JSON-LD graph for the resume.
 *
 * This is the machine-facing half of the feature: it is what lets a search
 * crawler or a generative engine state facts about this person without parsing
 * prose. It renders on `/cv/for-bots`, which the visible resume points at
 * with `<link rel="alternate">`.
 *
 * ## No email, no telephone
 *
 * `Person` has both properties and this graph deliberately omits them. Publishing
 * an address in structured data is *worse* than putting it in prose — it is
 * pre-parsed for exactly the harvesters you least want. The whole point of the
 * request flow is that contact is the gated part; the facts are the public part.
 *
 * ## Why `worksFor` carries `OrganizationRole` objects
 *
 * A bare `Organization` can say where someone works but not when, or as what.
 * schema.org's documented idiom for that is a Role whose own property repeats the
 * outer one — so `worksFor: OrganizationRole { worksFor: Organization }` — with
 * `roleName`, `startDate` and `endDate` alongside. Absence of `endDate` is what
 * marks a role current, which is why `ResumeRole.end` is optional rather than
 * carrying a sentinel like "Present".
 *
 * Dates are ISO year-month from `ResumeRole.start`/`end`, not the human strings.
 * A parser can order a career from `2023-02`; it has to guess at "Feb 2023".
 *
 * ## Emphasis markers are stripped
 *
 * Prose in the data carries `**bold**`. A machine reading `**17 agents**` should
 * see the words, so everything here goes through `plainText()` rather than
 * `emphasize()` — structured data is data, not markup.
 */

/** A JSON-serialisable value. Keeps the return type honest without `any`. */
type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface JsonLdOptions {
  /** The assembled resume. */
  resume: Resume;
  /** Absolute origin, e.g. "https://eddie.engineering". No trailing slash. */
  siteUrl: string;
  /** Path of the page carrying the graph, e.g. "/cv/for-bots". */
  pagePath: string;
}

/** `Portland, OR` → locality and region, with no street address. */
function postalAddress(location: string): JsonValue {
  const [locality, region] = location.split(',').map((part) => part.trim());
  return {
    '@type': 'PostalAddress',
    addressLocality: locality ?? location,
    ...(region ? { addressRegion: region } : {}),
    addressCountry: 'US',
  };
}

/**
 * Typed as `ResumeRole`, not as the inferred literal.
 *
 * `RESUME` is `as const`, so TypeScript narrows each role to exactly the keys it
 * was written with — a role with no `end` has no `end` property to test, and
 * `role.end` is a compile error rather than `undefined`. Widening to the
 * interface restores the optionality the data model actually intends.
 */
function organizationRole(role: ResumeRole): JsonValue {
  return {
    '@type': 'OrganizationRole',
    roleName: role.role,
    startDate: role.start,
    // Omitted entirely for current roles — that absence is the signal.
    ...(role.end ? { endDate: role.end } : {}),
    worksFor: {
      '@type': 'Organization',
      name: role.org,
      ...(role.tier === 'selected' && role.summary
        ? { description: plainText(role.summary) }
        : {}),
    },
    ...(role.location ? { location: postalAddress(role.location) } : {}),
  };
}

/**
 * Build the `ProfilePage` graph.
 *
 * `ProfilePage` rather than a bare `Person`: it tells a consumer that this URL
 * *is* the canonical profile for the entity, which is the claim worth making
 * here, and it nests the `Person` as `mainEntity` so both are addressable.
 */
export function buildResumeJsonLd({
  resume: RESUME,
  siteUrl,
  pagePath,
}: JsonLdOptions): JsonValue {
  const pageUrl = `${siteUrl}${pagePath}`;
  const allRoles = rolesByRecency(RESUME);

  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    '@id': pageUrl,
    url: pageUrl,
    name: `${RESUME.name} — ${RESUME.headline}`,
    dateModified: new Date().toISOString().slice(0, 10),
    mainEntity: {
      '@type': 'Person',
      '@id': `${siteUrl}/#person`,
      name: RESUME.name,
      jobTitle: RESUME.headline,
      description: plainText(RESUME.longSummary),
      url: siteUrl,
      address: postalAddress(RESUME.location),
      // Profiles a consumer can use to confirm this is the same person.
      sameAs: [
        'https://github.com/pixelknitter',
        'https://linkedin.com/in/eddiefreeman',
        'https://thebetween.space',
      ],
      knowsAbout: RESUME.skills.flatMap((group) => group.items),
      hasOccupation: {
        '@type': 'Occupation',
        name: RESUME.headline,
        occupationLocation: postalAddress(RESUME.location),
        skills: RESUME.skills.flatMap((group) => group.items).join(', '),
      },
      worksFor: allRoles.map(organizationRole),
      alumniOf: RESUME.education.map((entry) => ({
        '@type': 'EducationalOrganization',
        name: entry.institution,
        description: plainText(entry.detail),
      })),
      // The talks. VideoObject is accurate — both are recorded sessions.
      subjectOf: RESUME.speaking.talks.map((talk) => ({
        '@type': 'VideoObject',
        name: talk.title,
        url: talk.url,
        description: plainText(talk.detail),
        publisher: { '@type': 'Organization', name: talk.org },
      })),
    },
  };
}
