import { describe, it, expect } from 'vitest';
import { buildResumeJsonLd } from './jsonld';
import { RESUME } from './resume.data';

/**
 * The graph is deliberately typed as plain JSON data, so navigating it in a test
 * means narrowing. `Record<string, unknown>` plus casts at the point of use keeps
 * that honest — `any` would silently accept a misspelled property and pass.
 */
type Node = Record<string, unknown>;

/*
 * Fed from the RESUME fixture rather than the content collection, because
 * `getCollection` needs the Astro runtime and vitest has none. The collection is
 * the runtime source; drift between the two is caught by the golden-render check
 * in the e2e suite, which reads the actual pages.
 */
const graph = buildResumeJsonLd({
  resume: RESUME,
  siteUrl: 'https://eddie.engineering',
  pagePath: '/air/resume/for-bots',
}) as Node;

const person = graph.mainEntity as Node;
const roles = person.worksFor as Node[];
const serialised = JSON.stringify(graph);

describe('the graph publishes no contact details', () => {
  // Structured data is the *worst* place to publish an address: it is pre-parsed
  // for exactly the harvesters you least want, and Person has both properties
  // available, so omitting them has to be deliberate and kept that way.
  it('sets neither email nor telephone on the Person', () => {
    expect('email' in person).toBe(false);
    expect('telephone' in person).toBe(false);
  });

  it('contains no email address or phone number anywhere', () => {
    expect(serialised).not.toMatch(/[^\s@"]+@[^\s@"]+\.[^\s@",]{2,}/);
    expect(serialised).not.toMatch(/\+?\d{3}[\s.-]\d{3}[\s.-]\d{4}/);
  });

  it('gives a locality and region but no street address', () => {
    expect(person.address as Node).toMatchObject({
      '@type': 'PostalAddress',
      addressLocality: 'Portland',
      addressRegion: 'OR',
    });
    expect('streetAddress' in (person.address as Node)).toBe(false);
  });
});

describe('shape', () => {
  it('is a ProfilePage wrapping a Person', () => {
    expect(graph['@type']).toBe('ProfilePage');
    expect(person['@type']).toBe('Person');
  });

  // Absolute, and always the production origin — a staging build that emitted
  // staging URLs would publish a second competing profile for the same person.
  it('uses absolute URLs on the production origin', () => {
    expect(graph.url).toBe('https://eddie.engineering/air/resume/for-bots');
    expect(person.url).toBe('https://eddie.engineering');
    for (const url of person.sameAs as string[])
      expect(url).toMatch(/^https:\/\//);
  });

  it('covers every role', () => {
    expect(roles).toHaveLength(RESUME.experience.length + 1);
  });

  it('dates every role with ISO year-month, not prose', () => {
    for (const role of roles) {
      const org = (role.worksFor as Node).name as string;
      expect(role['@type']).toBe('OrganizationRole');
      expect(role.startDate as string, org).toMatch(/^\d{4}-\d{2}$/);
      if ('endDate' in role) {
        expect(role.endDate as string, org).toMatch(/^\d{4}-\d{2}$/);
      }
    }
  });

  // Absence of endDate is the *only* signal that a role is current, so a
  // sentinel like "Present" leaking in would be read as a malformed date.
  it('marks current roles by omitting endDate, never by a sentinel', () => {
    const current = roles.filter((role) => !('endDate' in role));
    expect(current.length).toBeGreaterThan(0);
    expect(serialised).not.toContain('Present');
  });

  it('orders roles most recent first', () => {
    const starts = roles.map((role) => role.startDate as string);
    expect([...starts]).toEqual([...starts].sort().reverse());
  });

  it('lists every skill under knowsAbout', () => {
    const expected = RESUME.skills.flatMap((group) => group.items);
    expect(person.knowsAbout as string[]).toEqual(expected);
  });

  it('includes both talks and both schools', () => {
    expect(person.subjectOf as Node[]).toHaveLength(
      RESUME.speaking.talks.length,
    );
    expect(person.alumniOf as Node[]).toHaveLength(RESUME.education.length);
  });
});

describe('prose is machine-clean', () => {
  // A parser reading `**17 agents**` should see the words. plainText, not
  // emphasize — structured data is data, not markup.
  it('strips emphasis markers', () => {
    expect(serialised).not.toContain('**');
  });

  it('carries no HTML tags', () => {
    expect(serialised).not.toMatch(/<\/?[a-z]/i);
  });

  it('survives a JSON round-trip', () => {
    // It is injected into a <script> via JSON.stringify, so it must be plain data.
    expect(() => JSON.parse(serialised)).not.toThrow();
  });

  // The graph is interpolated into an inline <script>. A literal `</script>` in
  // any string would end the element early and inject markup into the page.
  it('contains no sequence that could close its own script element', () => {
    expect(serialised.toLowerCase()).not.toContain('</script');
  });
});
