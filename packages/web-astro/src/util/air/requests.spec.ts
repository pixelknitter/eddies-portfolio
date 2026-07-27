import { describe, it, expect } from 'vitest';
import {
  validateRequest,
  mintApprovalToken,
  verifyApprovalToken,
  mintAccessCode,
  verifyAccessCode,
  APPROVAL_TTL_MS,
} from './requests.mjs';
import { accessGrantedEmail, accessRequestNotification, escapeHtml } from './email.mjs';

const SECRET = 'test-signing-secret';

describe('request validation', () => {
  it('rejects a malformed address', () => {
    expect(validateRequest('not-an-email', 'I would like to talk about a role.').ok).toBe(false);
  });

  it('rejects a note too short to be a reason', () => {
    expect(validateRequest('a@b.co', 'hi').ok).toBe(false);
  });

  it('accepts and trims a real request', () => {
    const result = validateRequest('  Person@Example.com  ', '  Hiring for a platform role.  ');
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

    expect((await verifyApprovalToken(SECRET, forged, { now: 2_000 })).ok).toBe(false);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await mintApprovalToken('other-secret', {
      email: 'person@example.com',
      reason: 'Hiring.',
      issuedAt: 1_000,
    });
    expect((await verifyApprovalToken(SECRET, token, { now: 2_000 })).ok).toBe(false);
  });

  it('expires after the TTL', async () => {
    const token = await mintApprovalToken(SECRET, {
      email: 'person@example.com',
      reason: 'Hiring.',
      issuedAt: 0,
    });
    expect((await verifyApprovalToken(SECRET, token, { now: APPROVAL_TTL_MS + 1 })).ok).toBe(false);
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
    expect(await mintAccessCode(SECRET, 'a@b.co')).toBe(await mintAccessCode(SECRET, 'a@b.co'));
  });

  it('issues different codes to different people', async () => {
    expect(await mintAccessCode(SECRET, 'a@b.co')).not.toBe(await mintAccessCode(SECRET, 'c@d.co'));
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
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });

  it('includes both an html and a text part', () => {
    const message = accessGrantedEmail({ code: 'abc.def', airUrl: 'https://x.test/air/' });
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
    expect(notification.embeds[0].description).toContain('https://x.test/api/air/approve?token=t');
    expect(notification.embeds[0].fields[0].value).toBe('person@example.com');
  });

  it('truncates a reason long enough for Discord to cut off', () => {
    const notification = accessRequestNotification({
      email: 'a@b.co',
      reason: 'x'.repeat(2000),
      approveUrl: 'https://x.test/',
    });
    expect(notification.embeds[0].fields[1].value.length).toBeLessThanOrEqual(901);
  });
});
