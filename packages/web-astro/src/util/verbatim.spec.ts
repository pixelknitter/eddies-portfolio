import { describe, it, expect } from 'vitest';
import { findVerbatim, normalise } from './verbatim.mjs';

/**
 * Guards commit messages against reproducing sealed content.
 *
 * The repo is public, so a commit message quoting a sealed bullet publishes it
 * as surely as committing the plaintext would — and unlike a file, a message
 * cannot be unpublished. This is the check that runs before the message exists
 * anywhere but the editor.
 *
 * Pure and corpus-as-argument for the same reason `contentFingerprint` is: the
 * plaintext needs the key, and keeping the key out leaves this testable.
 */
describe('normalise', () => {
  it('strips markdown emphasis so **bold** matches its plain text', () => {
    expect(normalise('**damped-trend** projections')).toEqual(
      normalise('damped-trend projections'),
    );
  });

  it('folds case and punctuation', () => {
    expect(normalise('Payroll, weekly — 10 minutes.')).toEqual(
      normalise('payroll weekly 10 minutes'),
    );
  });

  it('treats an em-dash as a word boundary, not a character', () => {
    // Content prose is full of them. If they glued words together, a quoted
    // run either side of one would not match its source.
    expect(normalise('one—two')).toEqual(['one', 'two']);
  });
});

describe('findVerbatim', () => {
  const corpus = ['The quick brown fox jumps over the lazy dog near a river'];

  it('catches a run of n words lifted from the corpus', () => {
    const hit = findVerbatim('I changed the quick brown fox jumps over bit', corpus, 5);
    expect(hit).toBe('the quick brown fox jumps');
  });

  it('ignores an overlap shorter than n', () => {
    expect(findVerbatim('the quick brown thing', corpus, 5)).toBeNull();
  });

  it('matches through markdown and punctuation', () => {
    expect(
      findVerbatim('quoting **the quick brown fox jumps** here', corpus, 5),
    ).toBe('the quick brown fox jumps');
  });

  it('passes a message that describes shape rather than content', () => {
    expect(
      findVerbatim('Now section: 7 bullets to 5. Regenerated the PDFs.', corpus, 5),
    ).toBeNull();
  });

  it('is null-safe on an empty corpus or an empty message', () => {
    expect(findVerbatim('anything at all here', [], 5)).toBeNull();
    expect(findVerbatim('', corpus, 5)).toBeNull();
  });

  // A message shorter than the window cannot contain a window-length run, and
  // must not throw trying.
  it('handles a message shorter than the window', () => {
    expect(findVerbatim('two words', corpus, 5)).toBeNull();
  });

  /**
   * Measured against this repo: at a 5-word window, three of the six flagged
   * vault-touching commits matched on runs made entirely of function words —
   * "at all that is the". Those are English, not content, and a guard that is
   * wrong half the time is a guard people learn to bypass.
   *
   * Requiring two content-bearing words in the run removes all three without
   * losing a single real quotation, because real quotations carry nouns.
   */
  it('ignores a run made only of common words', () => {
    const stopwordy = ['it is the case that all of the work is done'];
    expect(findVerbatim('I think it is the case that we should', stopwordy, 5)).toBeNull();
  });

  it('still catches a run carrying content words', () => {
    const real = ['the damped trend revenue projections and staff career mapping'];
    expect(findVerbatim('added damped trend revenue projections and staff work', real, 5)).toBe(
      'damped trend revenue projections and',
    );
  });

  it('needs two content words, not one, to flag', () => {
    // "vertical" alone in a sea of function words is how the false positives
    // presented; one distinctive word is not evidence of quotation.
    const source = ['this is the vertical with the cleanest metric available'];
    expect(findVerbatim('which is the vertical with the', source, 5)).toBeNull();
  });
});
