// Relative, not `@util/…`: vitest.config.mts is deliberately alias-free, so a
// module reached from a spec has to resolve without Astro's tsconfig paths.
import { escapeHtml } from '../html.mjs';

/**
 * The one piece of formatting resume prose needs: emphasis.
 *
 * Nearly every bullet in the resume leans on a bolded clause — the number, the
 * outcome, the thing worth reading if you read nothing else. Three ways to
 * carry that through to the page were considered:
 *
 *   - **HTML in the data module.** Fastest, and what the source design does.
 *     Rejected: it forces `set:html` on data that then has to be trusted
 *     forever, and it makes the data unreadable at a glance — the thing the
 *     module exists to be.
 *   - **A markdown renderer.** Correct but disproportionate: a dependency and a
 *     parse pass to support exactly one inline construct.
 *   - **`**bold**` markers, escaped then converted.** What this does.
 *
 * Order matters and is the whole safety argument: escape first, *then* convert
 * the markers. Escaping cannot introduce `**`, so the conversion can only ever
 * act on markers that were in the source text. The output is safe to pass to
 * `set:html` even though nothing here is user input today — which matters
 * because the resume data may later be sourced from a content collection.
 */

/** Matches a `**bolded**` run that is neither empty nor spanning a `*`. */
const EMPHASIS = /\*\*([^*]+)\*\*/g;

/**
 * Convert `**bold**` markers in resume prose to `<strong>`, escaping everything
 * else. The result is HTML and is intended for `set:html`.
 *
 * @param text Resume prose, optionally containing `**bold**` runs.
 * @returns HTML-safe markup.
 */
export function emphasize(text: string): string {
  return escapeHtml(text).replace(EMPHASIS, '<strong>$1</strong>');
}

/**
 * Strip `**bold**` markers without producing markup.
 *
 * Used where the text has to be plain: the JSON-LD graph, `<meta>` content, and
 * the PDF outline. A machine reading `**17 agents**` should see `17 agents`, not
 * the asterisks and not `<strong>`.
 *
 * @param text Resume prose, optionally containing `**bold**` runs.
 * @returns The same prose with emphasis markers removed.
 */
export function plainText(text: string): string {
  return text.replace(EMPHASIS, '$1');
}
