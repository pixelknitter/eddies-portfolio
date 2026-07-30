/**
 * Access requests for A.I.R.
 *
 * A visitor asks for access, Eddie approves from Discord, and the visitor gets
 * a code by email. All of it runs on signed tokens rather than a datastore —
 * there is no KV namespace to create, no binding id to get wrong, and no state
 * to clean up.
 *
 * ## On "single-use" approval links
 *
 * The approval link is idempotent rather than single-use, and that is a
 * deliberate upgrade rather than a shortcut. The token carries the requester's
 * email inside the signature, so replaying it can only ever do one thing:
 * email the same code to the same person again. There is nothing a second
 * click grants that the first did not.
 *
 * Strict single-use would need a datastore to record spent tokens, and it
 * would make the common failure — the requester never got the email — need a
 * whole new request instead of a second click. Expiry bounds the window; the
 * bound recipient bounds the damage.
 */

const encoder = new TextEncoder();

/** How long an approval link stays valid. */
export const APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Bounds on the request form. */
export const MAX_EMAIL_LENGTH = 254;
export const MAX_REASON_LENGTH = 1000;

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/**
 * @param {string} secret
 * @param {string} message
 * @returns {Promise<string>} base64url signature
 */
async function sign(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(message),
  );
  return toBase64Url(new Uint8Array(signature));
}

/**
 * Compare signatures without leaking their common prefix through timing.
 *
 * @param {string} a
 * @param {string} b
 */
function constantTimeEqual(a, b) {
  const length = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Validate a request form submission.
 *
 * The email check is deliberately loose. Strict RFC-5322 validation rejects
 * addresses that genuinely work, and the address is verified for real the only
 * way that counts — by whether the approval email arrives.
 *
 * @param {unknown} email
 * @param {unknown} reason
 * @returns {{ok: true, email: string, reason: string} | {ok: false, reason: string}}
 */
export function validateRequest(email, reason) {
  if (typeof email !== 'string' || typeof reason !== 'string') {
    return { ok: false, reason: 'Email and a note are both required.' };
  }

  const trimmedEmail = email.trim();
  const trimmedReason = reason.trim();

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail) ||
    trimmedEmail.length > MAX_EMAIL_LENGTH
  ) {
    return { ok: false, reason: 'That does not look like an email address.' };
  }
  if (trimmedReason.length < 10) {
    return {
      ok: false,
      reason: 'Tell me a little about why you are reaching out.',
    };
  }
  if (trimmedReason.length > MAX_REASON_LENGTH) {
    return {
      ok: false,
      reason: `Keep it under ${MAX_REASON_LENGTH} characters.`,
    };
  }

  return { ok: true, email: trimmedEmail, reason: trimmedReason };
}

/**
 * Mint the token behind an approval link.
 *
 * @param {string} secret
 * @param {{email: string, reason: string, issuedAt: number}} request
 * @returns {Promise<string>}
 */
export async function mintApprovalToken(secret, request) {
  const payload = toBase64Url(
    encoder.encode(
      JSON.stringify({
        e: request.email,
        r: request.reason,
        t: request.issuedAt,
      }),
    ),
  );
  return `${payload}.${await sign(secret, payload)}`;
}

/**
 * @param {string} secret
 * @param {string | null | undefined} token
 * @param {{now?: number, ttlMs?: number}} [options]
 * @returns {Promise<{ok: true, email: string, reason: string, issuedAt: number} | {ok: false, reason: string}>}
 */
export async function verifyApprovalToken(secret, token, options = {}) {
  const { now = Date.now(), ttlMs = APPROVAL_TTL_MS } = options;

  const [payload, signature] = String(token ?? '').split('.');
  if (!payload || !signature) return { ok: false, reason: 'malformed token' };

  if (!constantTimeEqual(signature, await sign(secret, payload))) {
    return { ok: false, reason: 'bad signature' };
  }

  let decoded;
  try {
    decoded = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
  } catch {
    return { ok: false, reason: 'unreadable payload' };
  }

  if (typeof decoded?.t !== 'number' || now - decoded.t > ttlMs) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, email: decoded.e, reason: decoded.r, issuedAt: decoded.t };
}

/**
 * Mint the access code a requester receives.
 *
 * The code carries the address it was issued to, signed. That is what lets the
 * ask endpoint verify it with no lookup, and it means a leaked code is
 * attributable — you can tell whose code is circulating.
 *
 * @param {string} secret
 * @param {string} email
 * @returns {Promise<string>}
 */
export async function mintAccessCode(secret, email) {
  const payload = toBase64Url(encoder.encode(email.toLowerCase()));
  const signature = (await sign(secret, `access:${payload}`)).slice(0, 22);
  return `${payload}.${signature}`;
}

/**
 * @param {string} secret
 * @param {string | null | undefined} code
 * @returns {Promise<{ok: true, email: string} | {ok: false}>}
 */
export async function verifyAccessCode(secret, code) {
  const [payload, signature] = String(code ?? '').split('.');
  if (!payload || !signature) return { ok: false };

  const expected = (await sign(secret, `access:${payload}`)).slice(0, 22);
  if (!constantTimeEqual(signature, expected)) return { ok: false };

  try {
    return {
      ok: true,
      email: new TextDecoder().decode(fromBase64Url(payload)),
    };
  } catch {
    return { ok: false };
  }
}

/**
 * How long a resume download link stays valid.
 *
 * Short, because the link goes straight back to the browser that asked for it: it
 * needs to survive a click and one retry, not a forwarded email. The value is a
 * parameter rather than baked in, which is the seam for emailing links once
 * Cloudflare Email Sending is enabled — that variant wants days, not minutes.
 */
export const RESUME_DOWNLOAD_TTL_MS = 15 * 60 * 1000;

/**
 * Mint a token scoped to one purpose.
 *
 * ## Why a purpose at all
 *
 * `AIR_SIGNING_SECRET` now signs two unrelated grants: access to the A.I.R. chat,
 * and permission to download a resume PDF. Without domain separation a token
 * issued for one could be replayed as the other, which is the classic way a shared
 * signing key turns two small permissions into one large one.
 *
 * The idiom already exists here — `mintAccessCode` signs `access:${payload}` while
 * `mintApprovalToken` signs the bare payload, so an approval link cannot be used
 * as an access code. This generalises it.
 *
 * ## Belt and braces
 *
 * The purpose is bound twice: mixed into the signature *and* carried in the
 * payload as `p`. The signature prefix is what actually prevents cross-purpose
 * reuse today; the claim is what stops a later refactor that drops the prefix from
 * silently re-opening it, because verification checks both.
 *
 * `mintApprovalToken` is deliberately left alone. It is the one token type with no
 * separator, which is exactly why this one has two — and changing it would
 * invalidate every approval link already in someone's inbox.
 *
 * @param {string} secret
 * @param {string} purpose e.g. 'download'
 * @param {Record<string, unknown>} claims Serialised into the payload.
 * @returns {Promise<string>}
 */
export async function mintPurposeToken(secret, purpose, claims = {}) {
  const payload = toBase64Url(
    encoder.encode(JSON.stringify({ ...claims, p: purpose, t: Date.now() })),
  );
  return `${payload}.${await sign(secret, `${purpose}:${payload}`)}`;
}

/**
 * Verify a purpose-scoped token.
 *
 * Returns a discriminated result rather than throwing, matching
 * `verifyApprovalToken`: the caller has to render something for a stale link, and
 * the reason is worth showing.
 *
 * @param {string} secret
 * @param {string} purpose The purpose the caller requires.
 * @param {string | null | undefined} token
 * @param {{now?: number, ttlMs?: number}} [options]
 * @returns {Promise<{ok: true, claims: Record<string, unknown>, issuedAt: number} | {ok: false, reason: string}>}
 */
export async function verifyPurposeToken(secret, purpose, token, options = {}) {
  const { now = Date.now(), ttlMs = RESUME_DOWNLOAD_TTL_MS } = options;

  const [payload, signature] = String(token ?? '').split('.');
  if (!payload || !signature) return { ok: false, reason: 'malformed token' };

  if (
    !constantTimeEqual(signature, await sign(secret, `${purpose}:${payload}`))
  ) {
    return { ok: false, reason: 'bad signature' };
  }

  let decoded;
  try {
    decoded = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
  } catch {
    return { ok: false, reason: 'unreadable payload' };
  }

  // The signature already bound the purpose. Checking the claim as well means a
  // future change to how the signature is composed cannot quietly widen scope.
  if (decoded?.p !== purpose) return { ok: false, reason: 'wrong purpose' };
  if (typeof decoded?.t !== 'number' || now - decoded.t > ttlMs) {
    return { ok: false, reason: 'expired' };
  }

  const { p: _purpose, t: issuedAt, ...claims } = decoded;
  return { ok: true, claims, issuedAt };
}
