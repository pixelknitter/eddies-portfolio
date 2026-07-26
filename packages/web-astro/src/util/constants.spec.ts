import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { buildingBlocks, iconUrl } from './constants';

/**
 * These tests lock down the shape of the tech-stack data that drives the
 * home page skill sections. They are intentionally structural so they keep
 * catching regressions across framework/tooling upgrades.
 */
describe('buildingBlocks', () => {
  const categories = Object.keys(buildingBlocks);
  const allBadges = Object.values(buildingBlocks).flat();

  it('exposes the expected skill categories', () => {
    expect(categories).toEqual([
      'Languages',
      'Frameworks',
      'Platforms',
      'Tools',
      'Infrastructure',
      'Analytics',
    ]);
  });

  it('has at least one badge in every category', () => {
    for (const [category, badges] of Object.entries(buildingBlocks)) {
      expect(badges.length, `${category} should not be empty`).toBeGreaterThan(0);
    }
  });

  it('gives every badge a non-empty label and tech key', () => {
    for (const badge of allBadges) {
      expect(badge.label, JSON.stringify(badge)).toBeTruthy();
      expect(badge.tech, JSON.stringify(badge)).toBeTruthy();
    }
  });

  it('has unique labels across all categories', () => {
    const labels = allBadges.map((b) => b.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  /**
   * Existing on disk is not enough. A global gitignore pattern (`Icon?`,
   * matching the `icons` directory case-insensitively) once meant these files
   * were present locally but never committed — so every deployed page showed
   * broken images while local builds looked fine. Assert they are tracked.
   */
  it('has every locally-hosted icon committed to git', () => {
    const localSrcs = allBadges
      .map((b) => b.src)
      .filter((src): src is string => typeof src === 'string' && src.startsWith('/'));

    expect(localSrcs.length, 'expected some self-hosted icons').toBeGreaterThan(0);

    // Vitest's import.meta.url is not a file: URL, so resolve from the
    // process cwd — Vitest runs rooted at the package directory.
    const tracked = new Set(
      execFileSync('git', ['ls-files', 'public'], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })
        .split('\n')
        .filter(Boolean)
        .map((p) => `/${p.replace(/^public\//, '')}`)
    );

    for (const src of localSrcs) {
      expect(
        tracked.has(src),
        `${src} is referenced but not tracked in git — it will 404 once deployed`
      ).toBe(true);
    }
  });

  it('only uses known optional fields', () => {
    const allowed = new Set(['label', 'tech', 'iconSuffix', 'src']);
    for (const badge of allBadges) {
      for (const key of Object.keys(badge)) {
        expect(allowed.has(key), `unexpected key "${key}"`).toBe(true);
      }
    }
  });
});

describe('iconUrl', () => {
  it('points at the devicon CDN over https', () => {
    expect(iconUrl).toMatch(/^https:\/\//);
    expect(iconUrl).toContain('devicon');
  });
});
