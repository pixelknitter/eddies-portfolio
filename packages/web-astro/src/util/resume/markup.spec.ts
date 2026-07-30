import { describe, it, expect } from 'vitest';
import { emphasize, plainText } from './markup';

describe('emphasize', () => {
  it('converts paired markers to strong', () => {
    expect(emphasize('cut payroll to **10–30 minutes** weekly')).toBe(
      'cut payroll to <strong>10–30 minutes</strong> weekly',
    );
  });

  it('handles several runs in one line', () => {
    expect(emphasize('**1M+ downloads** and **near-5-star ratings**')).toBe(
      '<strong>1M+ downloads</strong> and <strong>near-5-star ratings</strong>',
    );
  });

  it('leaves prose without markers untouched', () => {
    expect(emphasize('Portland, OR')).toBe('Portland, OR');
  });

  // The safety argument for this module: escaping runs first, and escaping
  // cannot introduce `**`, so the conversion can only act on markers that were
  // in the source. Injected markup therefore has no path to becoming real tags.
  it('escapes markup before converting emphasis', () => {
    expect(emphasize('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('escapes markup inside a bold run', () => {
    expect(emphasize('**<img src=x onerror=y>**')).toBe(
      '<strong>&lt;img src=x onerror=y&gt;</strong>',
    );
  });

  it('escapes both quote forms, so output is attribute-safe', () => {
    expect(emphasize(`he said "no" and 'maybe'`)).toBe(
      'he said &quot;no&quot; and &#39;maybe&#39;',
    );
  });

  // An unpaired marker is a typo, not an injection vector. It should survive
  // visibly rather than swallow the rest of the line into a tag.
  it('leaves an unpaired marker as literal text', () => {
    expect(emphasize('**not closed')).toBe('**not closed');
  });

  it('does not create an empty strong element', () => {
    expect(emphasize('****')).toBe('****');
  });

  it('tolerates an ampersand next to a marker', () => {
    expect(emphasize('**Partner & vendor development**')).toBe(
      '<strong>Partner &amp; vendor development</strong>',
    );
  });
});

describe('plainText', () => {
  it('removes markers without adding markup', () => {
    expect(plainText('**17 agents in production** of 27 registered')).toBe(
      '17 agents in production of 27 registered',
    );
  });

  // This feeds JSON-LD and <meta> content, where a machine reading `**17
  // agents**` should see the words and neither the asterisks nor a tag.
  it('produces no angle brackets', () => {
    expect(plainText('**bold** and plain')).not.toMatch(/[<>]/);
  });

  it('leaves an unpaired marker alone', () => {
    expect(plainText('**not closed')).toBe('**not closed');
  });

  it('does not escape entities, since the output is not markup', () => {
    expect(plainText('Partner & vendor')).toBe('Partner & vendor');
  });
});
