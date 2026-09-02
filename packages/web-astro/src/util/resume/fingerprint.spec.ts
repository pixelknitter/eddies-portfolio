import { describe, it, expect } from 'vitest';
import { contentFingerprint, resumeFingerprint } from './fingerprint.mjs';

/**
 * `resumeFingerprint` hashes source files this process can read. The sealed
 * resume content it *cannot* — the plaintext only exists while a key holder has
 * materialized it — so `contentFingerprint` takes the entries as an argument and
 * stays pure. That is what makes it testable here without the key, and it is the
 * only reason the two live side by side rather than as one function.
 */
describe('contentFingerprint', () => {
  const entry = (path: string, content: string) => ({ path, content });

  it('is stable across input ordering', () => {
    // The vault yields blobs in directory order, which is neither sorted nor
    // guaranteed stable between machines. If the hash inherited that ordering,
    // the guard would fail on a colleague's checkout for no reason at all.
    const a = [entry('b.md', 'two'), entry('a.md', 'one')];
    const b = [entry('a.md', 'one'), entry('b.md', 'two')];
    expect(contentFingerprint(a)).toBe(contentFingerprint(b));
  });

  it('changes when any content changes', () => {
    const before = [entry('a.md', 'one'), entry('b.md', 'two')];
    const after = [entry('a.md', 'one'), entry('b.md', 'two!')];
    expect(contentFingerprint(after)).not.toBe(contentFingerprint(before));
  });

  it('changes when a file is renamed', () => {
    // Renaming a resume section changes which entries the loader picks up, so
    // it has to move the hash even though no prose changed.
    expect(contentFingerprint([entry('a.md', 'one')])).not.toBe(
      contentFingerprint([entry('b.md', 'one')]),
    );
  });

  it('changes when a file is added or removed', () => {
    const one = [entry('a.md', 'one')];
    expect(contentFingerprint([...one, entry('b.md', '')])).not.toBe(
      contentFingerprint(one),
    );
  });

  // Without a separator, {path:'a', content:'bc'} and {path:'ab', content:'c'}
  // both feed "abc" to the digest and collide — a rename that shifts a character
  // between the two fields would slip past the guard.
  it('does not confuse a path boundary with content', () => {
    expect(contentFingerprint([entry('a', 'bc')])).not.toBe(
      contentFingerprint([entry('ab', 'c')]),
    );
  });

  it('labels the digest with its algorithm', () => {
    expect(contentFingerprint([entry('a.md', 'one')])).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
  });

  // A keyless checkout materializes nothing. That has to be a distinguishable
  // value rather than the hash of an empty list, or "no content" and "content I
  // could not read" would look identical to the check.
  it('reports an empty set rather than hashing nothing', () => {
    expect(contentFingerprint([])).toBe('');
  });
});

describe('resumeFingerprint', () => {
  // Guards the pairing with contentFingerprint: two hashes with the same shape,
  // recorded separately, so a failure names which half moved.
  it('labels the digest with its algorithm', () => {
    expect(resumeFingerprint()).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
