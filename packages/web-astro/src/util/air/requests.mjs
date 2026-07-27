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
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
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

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail) || trimmedEmail.length > MAX_EMAIL_LENGTH) {
    return { ok: false, reason: 'That does not look like an email address.' };
  }
  if (trimmedReason.length < 10) {
    return { ok: false, reason: 'Tell me a little about why you are reaching out.' };
  }
  if (trimmedReason.length > MAX_REASON_LENGTH) {
    return { ok: false, reason: `Keep it under ${MAX_REASON_LENGTH} characters.` };
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
    encoder.encode(JSON.stringify({ e: request.email, r: request.reason, t: request.issuedAt }))
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
    return { ok: true, email: new TextDecoder().decode(fromBase64Url(payload)) };
  } catch {
    return { ok: false };
  }
}
