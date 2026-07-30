import { describe, it, expect } from 'vitest';
import {
  RESUME,
  CONTACT,
  ENGINEER_COUNT,
  SHOW_INKITT_INTERVIEW,
  isResumeRoute,
  type ResumeRole,
} from './resume.data';

/**
 * Every string reachable from a value, with the path that led to it.
 *
 * The contact-leak assertions have to cover the whole structure rather than a
 * hand-listed set of fields — the failure being guarded against is someone
 * adding a *new* field with an address in it, which a field-by-field check would
 * not see.
 */
function walkStrings(
  value: unknown,
  path = 'RESUME',
): Array<{ path: string; text: string }> {
  if (typeof value === 'string') return [{ path, text: value }];
  if (Array.isArray(value))
    return value.flatMap((item, i) => walkStrings(item, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) =>
      walkStrings(item, `${path}.${key}`),
    );
  }
  return [];
}

const allStrings = walkStrings(RESUME);

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/;
// Deliberately a North-American-format pattern rather than "any run of digits":
// the resume is full of dates and metrics, and a loose pattern would flag
// "2004 – 2009" and teach everyone to ignore this test.
const PHONE = /(\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/;

describe('RESUME publishes no contact details', () => {
  // The load-bearing test in this file. The visible resume routes visitors
  // through the request form instead of publishing an inbox; that is the entire
  // basis of the lead-capture gate, and it is one careless edit away from being
  // undone silently.
  it('contains no email address anywhere', () => {
    const offenders = allStrings.filter(({ text }) => EMAIL.test(text));
    expect(offenders.map((o) => `${o.path}: ${o.text}`)).toEqual([]);
  });

  it('contains no phone number anywhere', () => {
    const offenders = allStrings.filter(({ text }) => PHONE.test(text));
    expect(offenders.map((o) => `${o.path}: ${o.text}`)).toEqual([]);
  });

  // The mirror image: proving the split is real, not that the details were
  // simply deleted. CONTACT exists for the print and PDF routes.
  it('keeps the details in CONTACT, for print surfaces only', () => {
    expect(CONTACT.email).toMatch(EMAIL);
    expect(CONTACT.email).toBe('connect@eddie.engineering');
  });

  it('has no phone number in CONTACT either', () => {
    const contactStrings = walkStrings(CONTACT, 'CONTACT');
    expect(contactStrings.filter(({ text }) => PHONE.test(text))).toEqual([]);
  });
});

describe('emphasis markers are well formed', () => {
  // An odd number of `**` renders literal asterisks on the page rather than
  // bold text — a silent typo that survives review because the sentence still
  // reads correctly in the source.
  it('pairs every ** marker', () => {
    const unbalanced = allStrings.filter(
      ({ text }) => (text.match(/\*\*/g)?.length ?? 0) % 2 !== 0,
    );
    expect(unbalanced.map((o) => o.path)).toEqual([]);
  });

  it('never leaves an empty bold run', () => {
    const empty = allStrings.filter(({ text }) => /\*\*\s*\*\*/.test(text));
    expect(empty.map((o) => o.path)).toEqual([]);
  });
});

describe('structure', () => {
  const roles: ResumeRole[] = [RESUME.now, ...RESUME.experience];

  it('gives every role the fields both layouts need', () => {
    for (const role of roles) {
      expect(role.org, 'org').toBeTruthy();
      expect(role.role, `role for ${role.org}`).toBeTruthy();
      expect(role.dates, `dates for ${role.org}`).toBeTruthy();
      expect(role.bullets.length, `bullets for ${role.org}`).toBeGreaterThan(0);
    }
  });

  it('gives every bullet non-empty text', () => {
    for (const role of roles) {
      for (const [i, bullet] of role.bullets.entries()) {
        expect(bullet.text.trim(), `${role.org} bullet ${i}`).not.toBe('');
      }
    }
  });

  // The visual page renders only `featured` bullets for selected roles. A
  // selected role with none would render as a heading with nothing under it.
  it('gives every selected-tier role at least one featured bullet', () => {
    for (const role of roles.filter((r) => r.tier === 'selected')) {
      const featured = role.bullets.filter((b) => b.featured);
      expect(
        featured.length,
        `featured bullets for ${role.org}`,
      ).toBeGreaterThan(0);
    }
  });

  // The "Earlier career" grid renders `compact` and `period`, not bullets.
  it('gives every earlier-tier role a compact line and a period', () => {
    for (const role of roles.filter((r) => r.tier === 'earlier')) {
      expect(role.compact, `compact for ${role.org}`).toBeTruthy();
      expect(role.period, `period for ${role.org}`).toBeTruthy();
    }
  });

  it('has four stats and four skill groups, as the layouts assume', () => {
    // The visual page lays stats out in a 4-column grid; a fifth would wrap
    // into a lopsided second row.
    expect(RESUME.stats).toHaveLength(4);
    expect(RESUME.skills).toHaveLength(4);
  });

  it('gives every skill group a tone the stylesheet defines', () => {
    for (const group of RESUME.skills) {
      expect(['accent', 'accent-2', 'neutral'], group.group).toContain(
        group.tone,
      );
    }
  });

  it('gives every talk a parseable absolute URL', () => {
    for (const talk of RESUME.speaking.talks) {
      expect(() => new URL(talk.url), talk.title).not.toThrow();
      expect(talk.url, talk.title).toMatch(/^https:\/\//);
    }
  });
});

describe('resolved design placeholders', () => {
  // The source design left `{{ engineerCount }}` unresolved in three places.
  // They are all fed from one constant precisely so they cannot disagree.
  it('uses the same engineer count in the stat tile and the speaking section', () => {
    const stat = RESUME.stats.find((s) =>
      s.label.includes('engineers interviewed'),
    );
    expect(stat?.value).toBe(ENGINEER_COUNT);
    expect(RESUME.speaking.evaluation).toContain(ENGINEER_COUNT);
  });

  it('honours the Inkitt-interview toggle', () => {
    const mentioned = RESUME.speaking.evaluation.includes('Inkitt');
    expect(mentioned).toBe(SHOW_INKITT_INTERVIEW);
  });

  it('leaves no unresolved template placeholder', () => {
    const leftover = allStrings.filter(({ text }) =>
      /\{\{|\}\}|<sc-if/.test(text),
    );
    expect(leftover.map((o) => `${o.path}: ${o.text}`)).toEqual([]);
  });
});

describe('isResumeRoute', () => {
  // Footer.astro uses this to decide whether its mail icon is a `mailto:` or a
  // link to the request form. A false negative republishes the address on the
  // one page whose premise is that it does not, so the boundaries matter.
  it('matches every resume surface', () => {
    for (const path of [
      '/air/resume',
      '/air/resume/',
      '/air/resume/for-bots',
      '/air/resume/print/human',
      '/air/resume/print/bot',
    ]) {
      expect(isResumeRoute(path), path).toBe(true);
    }
  });

  it('does not match other routes', () => {
    for (const path of [
      '/',
      '/air/',
      '/air',
      '/blog/',
      '/works/',
      '/air/resumes',
    ]) {
      expect(isResumeRoute(path), path).toBe(false);
    }
  });

  // `/air/resumes` above is the case a naive `startsWith('/air/resume')` gets
  // wrong: it would gate contact on an unrelated route that merely shares a
  // prefix. Harmless here, but the same bug in the other direction is not.
  it('requires a segment boundary, not just a prefix', () => {
    expect(isResumeRoute('/air/resume-archive')).toBe(false);
  });
});
