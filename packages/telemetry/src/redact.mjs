/**
 * The single sanitiser every telemetry payload passes through.
 *
 * ## Why one choke point
 *
 * The no-PII guarantees on this site are enforced by specs — `resume.spec.ts`
 * regex-scans the rendered DOM, `check-gated-assets.mjs` scans the bundle. A
 * scattered set of `fetch` calls to an analytics vendor could not inherit any of
 * that. One module can, and `redact.spec.ts` is what makes it structural.
 *
 * The DOM scan is the stronger guarantee of the two, because it is
 * source-agnostic: it catches a leak from telemetry, from resume data, or from
 * somewhere nobody anticipated. What it cannot see is the network. A `fetch`
 * carrying an email in a JSON body sails past it. That is this module's job, and
 * the two are complementary rather than overlapping.
 *
 * ## Redact by value and URL shape, never by key name
 *
 * This is the one rule to keep. A generic scrubber that drops property keys
 * matching `/token/i` deletes `properties.token` — which is where the PostHog
 * project key lives — and every event then 401s with "event submitted without an
 * api_key". It is a real, reported PostHog failure with no documented list of
 * reserved keys, and our redaction plan strips tokens from URLs, so it sits
 * directly in the blast radius.
 *
 * Hence: match on what a value *looks like*, and keep an explicit exemption list
 * for the two keys whose values are credentials we are deliberately sending.
 *
 * ## What must never appear
 *
 * | Never sent | Why |
 * |---|---|
 * | Any email address, anywhere | Including free text typed by a stranger |
 * | Any phone number | Same |
 * | Query strings on `/api/*` URLs | A resume `token` decodes to `{email, format}` |
 * | The `x-air-access` header | A credential; a personal code decodes to an email |
 * | The system prompt | Large, byte-identical, zero information per event |
 *
 * The last two are the caller's responsibility — they are never put into a
 * payload in the first place, which is cheaper and more obvious than removing
 * them afterwards.
 */

/** Mirrors the DOM scan in resume.spec.ts, deliberately. */
const EMAIL = /[\w.-]+@[\w.-]+\.\w{2,}/g;
const PHONE = /\+?\d{3}[\s.-]\d{3}[\s.-]\d{4}/g;

/**
 * Keys whose values are the PostHog project key and must survive untouched.
 *
 * Exported so the next person to add a scrubbing rule finds out why these are
 * special before generalising it — the alternative is rediscovering the 401 the
 * hard way, in production, where a silent ingestion failure looks exactly like
 * "telemetry was never wired up".
 */
export const PROJECT_KEY_SAFE_KEYS = Object.freeze(['token', 'api_key']);

/**
 * Bounds payload size. Not a privacy control: the question is sent whole because
 * `validateQuestion` already caps it at 500 characters, and a second ceiling
 * could cut a sentence mid-clause — which is exactly the debugging value being
 * paid for.
 */
const MAX_STRING = 2048;

/**
 * @param {string} value
 * @returns {string}
 */
function scrubString(value) {
  let out = value;

  // URLs first: strip the whole query string on API paths rather than
  // enumerating params. Strictly stronger, and it cannot be outflanked by a new
  // parameter nobody thought to add here.
  out = out.replace(/https?:\/\/[^\s"']+/g, (url) => {
    try {
      const parsed = new URL(url);
      if (parsed.pathname.startsWith('/api/')) {
        parsed.search = '';
        return parsed.toString();
      }
      // A `token` param is a credential wherever it appears, not only under
      // /api/.
      if (parsed.searchParams.has('token')) {
        parsed.searchParams.delete('token');
        return parsed.toString();
      }
      return url;
    } catch {
      // Not parseable as a URL; the value scrubs below like any other string.
      return url;
    }
  });

  out = out.replace(EMAIL, '[redacted:email]');
  out = out.replace(PHONE, '[redacted:phone]');

  // The ellipsis counts toward the ceiling — a "max" that can be exceeded by
  // the marker announcing the truncation is not a max.
  return out.length > MAX_STRING
    ? `${out.slice(0, MAX_STRING - 1)}…`
    : out;
}

/**
 * Deep-sanitise a payload, returning a copy.
 *
 * Never mutates its argument: a caller that logs what it built afterwards must
 * still see what it built.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function redact(value) {
  if (typeof value === 'string') {
    return /** @type {T} */ (scrubString(value));
  }

  if (Array.isArray(value)) {
    return /** @type {T} */ (value.map((item) => redact(item)));
  }

  if (value && typeof value === 'object') {
    const out = /** @type {Record<string, unknown>} */ ({});
    for (const [key, item] of Object.entries(value)) {
      // The exemption, and the only place a key name is consulted at all.
      out[key] = PROJECT_KEY_SAFE_KEYS.includes(key) ? item : redact(item);
    }
    return /** @type {T} */ (out);
  }

  // Numbers, booleans, null, undefined — nothing to scrub, and coercing them
  // would change the shape of a property the query layer depends on.
  return value;
}
