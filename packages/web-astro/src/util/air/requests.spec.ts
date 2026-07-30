import { describe, it, expect } from 'vitest';
import {
  validateRequest,
  mintApprovalToken,
  verifyApprovalToken,
  mintAccessCode,
  verifyAccessCode,
  APPROVAL_TTL_MS,
  mintPurposeToken,
  verifyPurposeToken,
  RESUME_DOWNLOAD_TTL_MS,
} from './requests.mjs';
import {
  accessGrantedEmail,
  accessRequestNotification,
  escapeHtml,
} from './email.mjs';
import { tierFromHostname, tierFromRequest, TIER_STYLE } from './tier.mjs';

const SECRET = 'test-signing-secret';

describe('request validation', () => {
  it('rejects a malformed address', () => {
    expect(
      validateRequest('not-an-email', 'I would like to talk about a role.').ok,
    ).toBe(false);
  });

  it('rejects a note too short to be a reason', () => {
    expect(validateRequest('a@b.co', 'hi').ok).toBe(false);
  });

  it('accepts and trims a real request', () => {
    const result = validateRequest(
      '  Person@Example.com  ',
      '  Hiring for a platform role.  ',
    );
    expect(result).toEqual({
      ok: true,
      email: 'Person@Example.com',
      reason: 'Hiring for a platform role.',
    });
  });
});

describe('approval tokens', () => {
  it('round-trips the request it carries', async () => {
    const token = await mintApprovalToken(SECRET, {
      email: 'person@example.com',
      reason: 'Hiring for a platform role.',
      issuedAt: 1_000,
    });
    const verified = await verifyApprovalToken(SECRET, token, { now: 2_000 });

    expect(verified).toMatchObject({
      ok: true,
      email: 'person@example.com',
      reason: 'Hiring for a platform role.',
    });
  });

  // The whole point of signing: a token whose payload was edited in transit —
  // to swap in someone else's address — must not verify.
  it('rejects a tampered payload', async () => {
    const token = await mintApprovalToken(SECRET, {
      email: 'person@example.com',
      reason: 'Hiring.',
      issuedAt: 1_000,
    });
    const [, signature] = token.split('.');
    const forged = `${btoa('{"e":"attacker@evil.com","r":"x","t":1000}')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')}.${signature}`;

    expect((await verifyApprovalToken(SECRET, forged, { now: 2_000 })).ok).toBe(
      false,
    );
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await mintApprovalToken('other-secret', {
      email: 'person@example.com',
      reason: 'Hiring.',
      issuedAt: 1_000,
    });
    expect((await verifyApprovalToken(SECRET, token, { now: 2_000 })).ok).toBe(
      false,
    );
  });

  it('expires after the TTL', async () => {
    const token = await mintApprovalToken(SECRET, {
      email: 'person@example.com',
      reason: 'Hiring.',
      issuedAt: 0,
    });
    expect(
      (await verifyApprovalToken(SECRET, token, { now: APPROVAL_TTL_MS + 1 }))
        .ok,
    ).toBe(false);
  });

  it('rejects malformed input rather than throwing', async () => {
    expect((await verifyApprovalToken(SECRET, 'garbage')).ok).toBe(false);
    expect((await verifyApprovalToken(SECRET, undefined)).ok).toBe(false);
  });
});

describe('access codes', () => {
  it('verifies a code it issued and reports who holds it', async () => {
    const code = await mintAccessCode(SECRET, 'Person@Example.com');
    expect(await verifyAccessCode(SECRET, code)).toEqual({
      ok: true,
      email: 'person@example.com',
    });
  });

  it('is deterministic for one address, so re-approving re-issues the same code', async () => {
    expect(await mintAccessCode(SECRET, 'a@b.co')).toBe(
      await mintAccessCode(SECRET, 'a@b.co'),
    );
  });

  it('issues different codes to different people', async () => {
    expect(await mintAccessCode(SECRET, 'a@b.co')).not.toBe(
      await mintAccessCode(SECRET, 'c@d.co'),
    );
  });

  it('rejects a code minted with another secret', async () => {
    const code = await mintAccessCode('other', 'a@b.co');
    expect((await verifyAccessCode(SECRET, code)).ok).toBe(false);
  });

  // Someone editing the address half of their own code to claim another
  // identity must fail — the signature covers the address.
  it('rejects an edited address', async () => {
    const code = await mintAccessCode(SECRET, 'a@b.co');
    const [, signature] = code.split('.');
    const forged = `${btoa('boss@company.com').replace(/=+$/, '')}.${signature}`;
    expect((await verifyAccessCode(SECRET, forged)).ok).toBe(false);
  });
});

describe('email templates', () => {
  it('escapes untrusted text', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('includes both an html and a text part', () => {
    const message = accessGrantedEmail({
      code: 'abc.def',
      airUrl: 'https://x.test/air/',
    });
    expect(message.html).toContain('abc.def');
    expect(message.text).toContain('abc.def');
    expect(message.subject).toBeTruthy();
  });

  it('puts the approval link in the Discord notification', () => {
    const notification = accessRequestNotification({
      email: 'person@example.com',
      reason: 'Hiring.',
      approveUrl: 'https://x.test/api/air/approve?token=t',
    });
    expect(notification.embeds[0].description).toContain(
      'https://x.test/api/air/approve?token=t',
    );
    expect(notification.embeds[0].fields[0].value).toBe('person@example.com');
  });

  it('truncates a reason long enough for Discord to cut off', () => {
    const notification = accessRequestNotification({
      email: 'a@b.co',
      reason: 'x'.repeat(2000),
      approveUrl: 'https://x.test/',
    });
    expect(notification.embeds[0].fields[1].value.length).toBeLessThanOrEqual(
      901,
    );
  });
});

describe('tier detection', () => {
  it('maps each known hostname to its tier', () => {
    expect(tierFromHostname('eddie.engineering')).toBe('production');
    expect(tierFromHostname('www.eddie.engineering')).toBe('production');
    expect(tierFromHostname('staging.eddie.engineering')).toBe('staging');
    expect(tierFromHostname('feat-air-dev.eddie.engineering')).toBe('dev');
    expect(tierFromHostname('localhost')).toBe('local');
    expect(tierFromHostname('127.0.0.1')).toBe('local');
  });

  it('is case-insensitive', () => {
    expect(tierFromHostname('Eddie.Engineering')).toBe('production');
  });

  // Under-claiming is the safe direction: an unrecognised host prompts a
  // second look rather than granting production access on a guess.
  it('treats anything unrecognised as dev, never production', () => {
    expect(tierFromHostname('eddies-portfolio.workers.dev')).toBe('dev');
    expect(tierFromHostname('eddie.engineering.evil.com')).toBe('dev');
    expect(tierFromHostname(undefined)).toBe('dev');
    expect(tierFromHostname('')).toBe('dev');
  });

  it('does not confuse a staging-looking subdomain with production', () => {
    expect(tierFromHostname('staging.eddie.engineering')).not.toBe(
      'production',
    );
  });
});

describe('tier from a request', () => {
  const requestWith = (host?: string) =>
    ({
      headers: {
        get: (name: string) => (name === 'host' ? (host ?? null) : null),
      },
    }) as Request;

  // The regression this guards: under wrangler dev, context.url reflects the
  // custom domain in wrangler.jsonc, so a localhost request announced itself
  // as Production. The Host header is what the client actually asked for.
  it('prefers the Host header over a reconstructed URL', () => {
    expect(
      tierFromRequest(
        requestWith('127.0.0.1:4411'),
        new URL('https://eddie.engineering/x'),
      ),
    ).toBe('local');
  });

  it('strips the port before matching', () => {
    expect(tierFromRequest(requestWith('staging.eddie.engineering:443'))).toBe(
      'staging',
    );
  });

  it('falls back to the URL when there is no Host header', () => {
    expect(
      tierFromRequest(
        requestWith(undefined),
        new URL('https://eddie.engineering/x'),
      ),
    ).toBe('production');
  });
});

describe('notification carries the environment', () => {
  it('names the tier in the title, a field, and the colour', () => {
    const notification = accessRequestNotification({
      email: 'a@b.co',
      reason: 'Hiring.',
      approveUrl: 'https://staging.eddie.engineering/api/air/approve?token=t',
      tier: 'staging',
    });

    expect(notification.embeds[0].title).toContain('Staging');
    expect(notification.embeds[0].color).toBe(TIER_STYLE.staging.colour);
    expect(
      notification.embeds[0].fields.some((f) => f.value === 'Staging'),
    ).toBe(true);
  });

  it('gives production its own colour so the two are not confusable', () => {
    expect(TIER_STYLE.production.colour).not.toBe(TIER_STYLE.staging.colour);
    expect(TIER_STYLE.production.colour).not.toBe(TIER_STYLE.dev.colour);
  });

  it('falls back to dev when no tier is supplied', () => {
    const notification = accessRequestNotification({
      email: 'a@b.co',
      reason: 'Hiring.',
      approveUrl: 'https://x.test/',
    });
    expect(notification.embeds[0].title).toContain('Dev preview');
  });
});

describe('purpose-scoped tokens', () => {
  it('round-trips its claims', async () => {
    const token = await mintPurposeToken(SECRET, 'download', {
      email: 'jane@acme.com',
      format: 'human',
    });
    const result = await verifyPurposeToken(SECRET, 'download', token);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims).toEqual({ email: 'jane@acme.com', format: 'human' });
    expect(result.issuedAt).toBeTypeOf('number');
  });

  /**
   * The reason purpose scoping exists. One secret now signs two unrelated grants —
   * chat access and a PDF download — and without separation either could be
   * replayed as the other, turning two small permissions into one large one.
   */
  describe('cannot be replayed across purposes', () => {
    it('rejects a token minted for another purpose', async () => {
      const token = await mintPurposeToken(SECRET, 'download', {
        email: 'a@b.co',
      });
      const result = await verifyPurposeToken(SECRET, 'newsletter', token);
      expect(result.ok).toBe(false);
    });

    it('does not accept an A.I.R. approval token as a download token', async () => {
      const approval = await mintApprovalToken(SECRET, {
        email: 'a@b.co',
        reason: 'because',
        issuedAt: Date.now(),
      });
      expect((await verifyPurposeToken(SECRET, 'download', approval)).ok).toBe(
        false,
      );
    });

    it('does not accept a download token as an A.I.R. approval', async () => {
      const download = await mintPurposeToken(SECRET, 'download', {
        email: 'a@b.co',
      });
      expect((await verifyApprovalToken(SECRET, download)).ok).toBe(false);
    });

    it('does not accept a download token as an access code', async () => {
      const download = await mintPurposeToken(SECRET, 'download', {
        email: 'a@b.co',
      });
      expect((await verifyAccessCode(SECRET, download)).ok).toBe(false);
    });

    it('does not accept an access code as a download token', async () => {
      const code = await mintAccessCode(SECRET, 'a@b.co');
      expect((await verifyPurposeToken(SECRET, 'download', code)).ok).toBe(
        false,
      );
    });
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await mintPurposeToken(SECRET, 'download', {
      email: 'a@b.co',
    });
    const result = await verifyPurposeToken(
      'another-secret',
      'download',
      token,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('bad signature');
  });

  it('rejects a tampered payload', async () => {
    const token = await mintPurposeToken(SECRET, 'download', {
      email: 'a@b.co',
    });
    const [, signature] = token.split('.');
    const forged = `${btoa(JSON.stringify({ email: 'evil@x.co', p: 'download', t: Date.now() }))}.${signature}`;
    expect((await verifyPurposeToken(SECRET, 'download', forged)).ok).toBe(
      false,
    );
  });

  it('expires', async () => {
    const token = await mintPurposeToken(SECRET, 'download', {
      email: 'a@b.co',
    });
    const result = await verifyPurposeToken(SECRET, 'download', token, {
      now: Date.now() + RESUME_DOWNLOAD_TTL_MS + 1000,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('expired');
  });

  it('is still valid just inside its window', async () => {
    const token = await mintPurposeToken(SECRET, 'download', {
      email: 'a@b.co',
    });
    const result = await verifyPurposeToken(SECRET, 'download', token, {
      now: Date.now() + RESUME_DOWNLOAD_TTL_MS - 1000,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects malformed input without throwing', async () => {
    for (const bad of ['', 'nodot', 'a.b.c.d', null, undefined]) {
      expect(
        (await verifyPurposeToken(SECRET, 'download', bad)).ok,
        String(bad),
      ).toBe(false);
    }
  });

  // 15 minutes: the link goes straight back to the requesting browser, so it has to
  // survive a click and a retry — not a forward.
  it('uses a short download window', () => {
    expect(RESUME_DOWNLOAD_TTL_MS).toBeLessThanOrEqual(60 * 60 * 1000);
    expect(RESUME_DOWNLOAD_TTL_MS).toBeGreaterThanOrEqual(5 * 60 * 1000);
  });
});
