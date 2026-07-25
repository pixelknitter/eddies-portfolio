import { describe, it, expect } from 'vitest';
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
