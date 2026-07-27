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
// A passphrase, not key material — scrypt stretches it.
const KEY = 'a memorable passphrase for tests';

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
  it('suggests a high-entropy passphrase', () => {
    const generated = run(['keygen']).split('\n')[0];
    expect(Buffer.from(generated, 'base64')).toHaveLength(32);
  });

  it('accepts an ordinary passphrase, not just base64 key material', () => {
    const source = join(dir, 'post.md');
    writeFileSync(source, 'content\n');
    run(['seal', source], { CONTENT_SEAL_KEY: 'correct horse battery staple' });
    run(['unseal', `${source}.sealed`], { CONTENT_SEAL_KEY: 'correct horse battery staple' });
    expect(readFileSync(source, 'utf8')).toBe('content\n');
  });

  it('writes a self-describing envelope so a format change is detectable', () => {
    const source = join(dir, 'post.md');
    writeFileSync(source, 'content\n');
    run(['seal', source], { CONTENT_SEAL_KEY: KEY });

    const envelope = JSON.parse(readFileSync(`${source}.sealed`, 'utf8'));
    expect(envelope).toMatchObject({ v: 1, algo: 'aes-256-gcm', kdf: 'scrypt' });
    expect(envelope.salt).toHaveLength(32);
  });

  // Per-file salt: two files with identical content must not produce
  // identical blobs, or the archive leaks which posts repeat.
  it('salts each file separately', () => {
    const a = join(dir, 'a.md');
    const b = join(dir, 'b.md');
    writeFileSync(a, 'identical\n');
    writeFileSync(b, 'identical\n');
    run(['seal', a], { CONTENT_SEAL_KEY: KEY });
    run(['seal', b], { CONTENT_SEAL_KEY: KEY });

    expect(readFileSync(`${a}.sealed`, 'utf8')).not.toBe(readFileSync(`${b}.sealed`, 'utf8'));
  });

  it('refuses an envelope from an unknown format version', () => {
    const source = join(dir, 'post.md');
    writeFileSync(source, 'content\n');
    run(['seal', source], { CONTENT_SEAL_KEY: KEY });

    const envelope = JSON.parse(readFileSync(`${source}.sealed`, 'utf8'));
    writeFileSync(`${source}.sealed`, JSON.stringify({ ...envelope, v: 99 }));

    expect(() => run(['unseal', `${source}.sealed`], { CONTENT_SEAL_KEY: KEY })).toThrow();
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
    const envelope = JSON.parse(readFileSync(sealed, 'utf8'));
    envelope.data = Buffer.from('tampered').toString('base64');
    writeFileSync(sealed, JSON.stringify(envelope));

    expect(() => run(['unseal', sealed], { CONTENT_SEAL_KEY: KEY })).toThrow();
  });

  it('rejects an empty passphrase', () => {
    const source = join(dir, 'post.md');
    writeFileSync(source, 'content\n');
    expect(() => run(['seal', source], { CONTENT_SEAL_KEY: '   ' })).toThrow();
  });
});
