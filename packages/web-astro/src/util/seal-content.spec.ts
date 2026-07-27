import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Round-trip coverage for the content sealer.
 *
 * Driven through the CLI rather than by importing it, because the script's
 * contract *is* the CLI — exit codes and file side effects are what CI relies
 * on, and testing the functions directly would not cover them.
 *
 * It lives under web-astro because that is the only package with a test
 * runner configured; the repo root has none. The script itself is repo-level,
 * hence the walk back up to it.
 */

const REPO_ROOT = join(process.cwd(), '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts/seal-content.mjs');
const KEY = Buffer.alloc(32, 7).toString('base64');

let dir: string;

function run(args: string[], env: Record<string, string> = {}) {
  return execFileSync('node', [SCRIPT, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    cwd: REPO_ROOT,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seal-'));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('seal-content', () => {
  it('generates a 32-byte key', () => {
    const generated = run(['keygen']).split('\n')[0];
    expect(Buffer.from(generated, 'base64')).toHaveLength(32);
  });

  it('produces a blob that does not contain the plaintext', () => {
    const source = join(dir, 'post.md');
    writeFileSync(source, '---\ntitle: Secret launch\n---\n\nUnreleased.\n');

    run(['seal', source], { CONTENT_SEAL_KEY: KEY });

    const blob = readFileSync(`${source}.sealed`, 'utf8');
    expect(blob).not.toContain('Secret launch');
    expect(blob).not.toContain('Unreleased');
    // Sealing removes the plaintext — leaving it defeats the purpose.
    expect(existsSync(source)).toBe(false);
  });

  it('round-trips byte for byte', () => {
    const source = join(dir, 'post.md');
    const original = '---\ntitle: Round trip\n---\n\nBody with émoji 🎉 and\ttabs.\n';
    writeFileSync(source, original);

    run(['seal', source], { CONTENT_SEAL_KEY: KEY });
    run(['unseal', `${source}.sealed`], { CONTENT_SEAL_KEY: KEY });

    expect(readFileSync(source, 'utf8')).toBe(original);
  });

  it('refuses a wrong key instead of emitting garbage', () => {
    const source = join(dir, 'post.md');
    writeFileSync(source, 'content\n');
    run(['seal', source], { CONTENT_SEAL_KEY: KEY });

    const wrong = Buffer.alloc(32, 9).toString('base64');
    expect(() => run(['unseal', `${source}.sealed`], { CONTENT_SEAL_KEY: wrong })).toThrow();
    expect(existsSync(source)).toBe(false);
  });

  it('rejects a tampered blob', () => {
    const source = join(dir, 'post.md');
    writeFileSync(source, 'content\n');
    run(['seal', source], { CONTENT_SEAL_KEY: KEY });

    const sealed = `${source}.sealed`;
    const [iv, tag, body] = readFileSync(sealed, 'utf8').trim().split('.');
    writeFileSync(sealed, `${iv}.${tag}.${Buffer.from('tampered').toString('base64')}\n`);

    expect(() => run(['unseal', sealed], { CONTENT_SEAL_KEY: KEY })).toThrow();
  });

  it('rejects a key that is not 32 bytes', () => {
    const source = join(dir, 'post.md');
    writeFileSync(source, 'content\n');
    expect(() => run(['seal', source], { CONTENT_SEAL_KEY: 'dG9vLXNob3J0' })).toThrow();
  });
});
