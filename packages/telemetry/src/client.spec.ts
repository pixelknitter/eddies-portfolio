import { describe, it, expect } from 'vitest';

import { createNoopClient } from './client.mjs';

/**
 * The client interface, and the implementation that does nothing.
 *
 * The no-op is not a convenience. Every call site has to work before anything is
 * configured, so an unset key, a blocked script, or a failed dynamic import
 * degrades to silence rather than to a broken page. That is the guarantee
 * `createTransport` already makes in the Worker, held to on this side too.
 */
describe('createNoopClient', () => {
  it('answers every method without throwing', () => {
    const client = createNoopClient();

    expect(() => client.init({ token: 'x' })).not.toThrow();
    expect(() => client.pageview('/cv')).not.toThrow();
    expect(() => client.capture('anything', { a: 1 })).not.toThrow();
    expect(() => client.surveyShown('s', 't')).not.toThrow();
    expect(() => client.surveySent('s', 't', {})).not.toThrow();
  });

  it('reports that it is not active', () => {
    // The caller uses this to decide whether the real client has taken over, so
    // a no-op claiming to be active would make the swap untestable.
    expect(createNoopClient().active).toBe(false);
  });
});
