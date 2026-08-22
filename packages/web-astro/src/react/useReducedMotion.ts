import React from 'react';

/**
 * Whether this visitor has asked the system to stop moving things.
 *
 * ## Why it is not read during render
 *
 * These islands are server-rendered, where there is no `matchMedia`, and
 * branching on it during render would make the first client render disagree
 * with the server's HTML. So it starts `false` — the still-not-yet-animating
 * state — and corrects on mount. Every consumer must therefore treat `false` as
 * "not known to prefer reduced motion" rather than "prefers motion", which is
 * the safe direction: an animation that starts a frame late is a smaller
 * failure than one that plays for someone who asked it not to.
 *
 * ## Why it subscribes
 *
 * Reading once on mount leaves someone who changes the system setting mid-visit
 * with the old answer until they reload. The CSS in `motion.css` is already
 * gated by the media query and updates on its own; this keeps the JavaScript
 * half — the timers that decide *when* to animate — in step with it.
 *
 * @returns `true` when the visitor prefers reduced motion.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);

    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

export default useReducedMotion;
