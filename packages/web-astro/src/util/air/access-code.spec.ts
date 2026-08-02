import { describe, it, expect, beforeEach } from 'vitest';
import { readStoredCode, storeCode, STORAGE_KEY } from './access-code.mjs';

describe('access code storage', () => {
  beforeEach(() => window.localStorage.clear());

  it('returns an empty string when nothing is stored', () => {
    expect(readStoredCode()).toBe('');
  });

  it('round-trips a code', () => {
    storeCode('conf-2026');
    expect(readStoredCode()).toBe('conf-2026');
  });

  it('trims surrounding whitespace, which pasting a code from a card adds', () => {
    storeCode('  conf-2026  ');
    expect(readStoredCode()).toBe('conf-2026');
  });

  it('removes the key rather than storing an empty value', () => {
    storeCode('conf-2026');
    storeCode('');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(readStoredCode()).toBe('');
  });

  it('survives storage being unavailable', () => {
    const original = window.localStorage.getItem;
    // Safari in private mode throws on access rather than returning null.
    Object.defineProperty(window.localStorage, 'getItem', {
      configurable: true,
      value: () => { throw new DOMException('denied'); },
    });
    expect(readStoredCode()).toBe('');
    Object.defineProperty(window.localStorage, 'getItem', {
      configurable: true,
      value: original,
    });
  });
});
