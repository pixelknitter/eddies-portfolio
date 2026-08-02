import { describe, it, expect } from 'vitest';

import { redact, PROJECT_KEY_SAFE_KEYS } from './redact.mjs';

/**
 * The sanitiser every telemetry payload passes through.
 *
 * This test exists because the no-PII guarantees elsewhere are enforced by
 * specs, and a scattered set of `fetch` calls could not inherit them. One choke
 * point can, and this is the test that makes it structural.
 *
 * `resume.spec.ts` already regex-scans the rendered DOM for email- and
 * phone-shaped strings — a stronger guarantee than anything here, because it is
 * source-agnostic. What it cannot see is the network: a `fetch` carrying an
 * email in a JSON body sails straight past it. That is the gap these cover.
 */

/** The patterns that must never survive, mirroring the DOM scan in resume.spec.ts. */
const EMAIL = /[\w.-]+@[\w.-]+\.\w{2,}/;
const PHONE = /\+?\d{3}[\s.-]\d{3}[\s.-]\d{4}/;
const TOKEN_PARAM = /[?&]token=/;

describe('redact', () => {
  it('removes an email address from anywhere in the payload', () => {
    const clean = redact({
      question: 'Can I reach Eddie at eddie@example.com about the role?',
    });

    expect(JSON.stringify(clean)).not.toMatch(EMAIL);
  });

  it('removes an email from a stranger’s free text', () => {
    // The rating comment is the highest-risk field in the design: unbounded
    // text typed by someone we know nothing about.
    const clean = redact({ comment: 'wrong — my address is a.b-c@sub.domain.co' });

    expect(JSON.stringify(clean)).not.toMatch(EMAIL);
  });

  it('removes a phone number', () => {
    const clean = redact({ comment: 'call 555 867 5309' });

    expect(JSON.stringify(clean)).not.toMatch(PHONE);
  });

  it('strips the query string from an API url, token and all', () => {
    // A resume download token decodes to {email, format}. Blanket-stripping the
    // query string is strictly stronger than enumerating the params that matter.
    const clean = redact({
      $current_url: 'https://eddie.engineering/api/resume/download?token=eyJlbWFpbCI6ImFAYi5jbyJ9&format=full',
    });

    const serialised = JSON.stringify(clean);
    expect(serialised).not.toMatch(TOKEN_PARAM);
    expect(serialised).toContain('/api/resume/download');
  });

  it('keeps the path of a non-API url intact', () => {
    // Pageviews are the point of capturing a url at all; over-redacting them
    // would make the property useless.
    const clean = redact({ $current_url: 'https://eddie.engineering/blog/a-post/' });

    expect(clean.$current_url).toBe('https://eddie.engineering/blog/a-post/');
  });

  it('redacts nested values, not just top-level ones', () => {
    const clean = redact({
      properties: { context: { note: 'forwarded from eddie@example.com' } },
    });

    expect(JSON.stringify(clean)).not.toMatch(EMAIL);
  });

  it('redacts inside arrays', () => {
    const clean = redact({
      $ai_input: [{ role: 'user', content: 'mail me at a@b.co' }],
    });

    expect(JSON.stringify(clean)).not.toMatch(EMAIL);
  });

  /**
   * The footgun, and the reason this module redacts by value rather than by key
   * name.
   *
   * A generic scrubber that drops keys matching /token/i deletes
   * `properties.token` — which is where the PostHog project key lives — and
   * every event then 401s with "event submitted without an api_key". A
   * sanitiser that passes the checks above by deleting everything is not a
   * passing sanitiser, so this asserts the inverse.
   */
  it('preserves the project key, which lives under a key called token', () => {
    const clean = redact({ token: 'phc_realprojectkey', event: '$ai_trace' });

    expect(clean.token).toBe('phc_realprojectkey');
  });

  it('preserves api_key for the same reason', () => {
    const clean = redact({ api_key: 'phc_realprojectkey' });

    expect(clean.api_key).toBe('phc_realprojectkey');
  });

  it('names the keys whose values are exempt, so the reason is discoverable', () => {
    // Exported rather than inlined: the next person to add a scrubbing rule
    // needs to find out why these are special before they generalise it.
    expect(PROJECT_KEY_SAFE_KEYS).toContain('token');
    expect(PROJECT_KEY_SAFE_KEYS).toContain('api_key');
  });

  it('survives a poisoned payload carrying every hazard at once', () => {
    const serialised = JSON.stringify(
      redact({
        api_key: 'phc_realprojectkey',
        event: '$ai_generation',
        properties: {
          token: 'phc_realprojectkey',
          $ai_input: [{ role: 'user', content: 'reach me: eddie@example.com / 555 867 5309' }],
          $current_url: 'https://eddie.engineering/api/air/ask?token=secret',
          comment: 'my other address is other.person@corp.io',
        },
      }),
    );

    expect(serialised).not.toMatch(EMAIL);
    expect(serialised).not.toMatch(PHONE);
    expect(serialised).not.toMatch(TOKEN_PARAM);
    // …and the key still made it through.
    expect(serialised).toContain('phc_realprojectkey');
  });

  it('truncates a long string so one answer cannot dominate a payload', () => {
    const clean = redact({ answer: 'x'.repeat(5000) });

    // The ceiling bounds payload size; it protects nothing on its own, which is
    // why the question is sent whole (validateQuestion already caps it at 500).
    expect((clean.answer as string).length).toBeLessThanOrEqual(2048);
  });

  it('leaves values that are not strings alone', () => {
    const clean = redact({
      grounded: true,
      retrieved_count: 4,
      top_score: 0.82,
      citations: null,
    });

    expect(clean).toEqual({
      grounded: true,
      retrieved_count: 4,
      top_score: 0.82,
      citations: null,
    });
  });

  it('does not mutate the payload it was given', () => {
    const original = { question: 'mail a@b.co' };
    redact(original);

    // A caller that logs the original afterwards must still see what it built.
    expect(original.question).toBe('mail a@b.co');
  });
});
