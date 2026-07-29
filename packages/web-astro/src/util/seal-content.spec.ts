import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, rmSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Driven through the CLI rather than by importing functions, because the CLI
 * *is* the contract — exit codes and file side effects are what CI and the
 * pre-commit hook depend on.
 *
 * Lives under web-astro because that is the only package with a test runner;
 * the script itself is repo-level, hence the walk up.
 */

const REPO_ROOT = join(process.cwd(), '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts/seal-content.mjs');
const VAULT = join(REPO_ROOT, 'packages/web-astro/content-vault');
const CONTENT = join(REPO_ROOT, 'packages/web-astro/src/content/star');
const KEY = 'a memorable passphrase for tests';

function run(args: string[], env: Record<string, string> = {}) {
  return execFileSync('node', [SCRIPT, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    cwd: REPO_ROOT,
  });
}

const tmpFiles: string[] = [];
function fixture(name: string, body: string) {
  const path = join(CONTENT, name);
  mkdirSync(CONTENT, { recursive: true });
  writeFileSync(path, body);
  tmpFiles.push(path);
  return path;
}

beforeEach(() => rmSync(VAULT, { recursive: true, force: true }));

afterEach(() => {
  for (const path of tmpFiles.splice(0)) rmSync(path, { force: true });
  rmSync(VAULT, { recursive: true, force: true });
});

describe('seal-content', () => {
  it('suggests a high-entropy passphrase', () => {
    expect(Buffer.from(run(['keygen']).split('\n')[0], 'base64')).toHaveLength(32);
  });

  // The leak this design exists to close: a blob called
  // `android-launch-ticketfly.md.sealed` gives away employer, platform and
  // theme even though the body is encrypted.
  it('gives blobs opaque names that reveal nothing about the file', () => {
    fixture('ticketfly-android-launch.md', 'body\n');
    run(['seal', 'packages/web-astro/src/content/star/ticketfly-android-launch.md'], {
      CONTENT_SEAL_KEY: KEY,
    });

    const names = readdirSync(VAULT).filter((f) => f.endsWith('.sealed'));
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^[0-9a-f]{32}\.sealed$/);
    expect(names[0]).not.toContain('ticketfly');
    expect(names[0]).not.toContain('android');
  });

  it('hides which collection a file came from', () => {
    fixture('a.md', 'body\n');
    run(['seal', 'packages/web-astro/src/content/star/a.md'], { CONTENT_SEAL_KEY: KEY });
    // Blobs sit in one flat vault, not under star/ or blog/.
    expect(existsSync(join(VAULT, readdirSync(VAULT).find((f) => f.endsWith('.sealed'))!))).toBe(true);
  });

  it('round-trips content and its path', () => {
    const original = '---\ntitle: Round trip\n---\n\nBody with émoji 🎉 and\ttabs.\n';
    const path = fixture('round-trip.md', original);
    run(['seal', 'packages/web-astro/src/content/star/round-trip.md'], { CONTENT_SEAL_KEY: KEY });

    expect(existsSync(path)).toBe(false); // sealing removes the plaintext
    run(['unseal-all'], { CONTENT_SEAL_KEY: KEY });
    expect(readFileSync(path, 'utf8')).toBe(original);
  });

  // Deterministic naming keeps diffs stable — re-sealing must not churn the
  // vault with a new blob every time.
  it('names a given path the same way every time', () => {
    fixture('stable.md', 'one\n');
    run(['seal', 'packages/web-astro/src/content/star/stable.md'], { CONTENT_SEAL_KEY: KEY });
    const first = readdirSync(VAULT).filter((f) => f.endsWith('.sealed'))[0];

    run(['unseal-all'], { CONTENT_SEAL_KEY: KEY });
    run(['seal', 'packages/web-astro/src/content/star/stable.md'], { CONTENT_SEAL_KEY: KEY });
    const after = readdirSync(VAULT).filter((f) => f.endsWith('.sealed'));

    expect(after).toHaveLength(1);
    expect(after[0]).toBe(first);
  });

  it('accepts an ordinary passphrase, not just base64 key material', () => {
    const path = fixture('phrase.md', 'content\n');
    run(['seal', 'packages/web-astro/src/content/star/phrase.md'], {
      CONTENT_SEAL_KEY: 'correct horse battery staple',
    });
    run(['unseal-all'], { CONTENT_SEAL_KEY: 'correct horse battery staple' });
    expect(readFileSync(path, 'utf8')).toBe('content\n');
  });

  it('refuses a wrong key rather than emitting garbage', () => {
    fixture('wrong-key.md', 'content\n');
    run(['seal', 'packages/web-astro/src/content/star/wrong-key.md'], { CONTENT_SEAL_KEY: KEY });
    expect(() => run(['unseal-all'], { CONTENT_SEAL_KEY: 'a different passphrase' })).toThrow();
  });

  it('rejects a tampered blob', () => {
    fixture('tamper.md', 'content\n');
    run(['seal', 'packages/web-astro/src/content/star/tamper.md'], { CONTENT_SEAL_KEY: KEY });

    const blob = join(VAULT, readdirSync(VAULT).find((f) => f.endsWith('.sealed'))!);
    const envelope = JSON.parse(readFileSync(blob, 'utf8'));
    envelope.data = Buffer.from('tampered').toString('base64');
    writeFileSync(blob, JSON.stringify(envelope));

    expect(() => run(['unseal-all'], { CONTENT_SEAL_KEY: KEY })).toThrow();
  });

  it('rejects an empty passphrase', () => {
    fixture('empty-key.md', 'content\n');
    expect(() =>
      run(['seal', 'packages/web-astro/src/content/star/empty-key.md'], { CONTENT_SEAL_KEY: '   ' })
    ).toThrow();
  });

  // What the pre-commit hook asks. It must answer for one path without
  // revealing any other.
  it('answers is-sealed by exit code', () => {
    fixture('sealed-one.md', 'a\n');
    const other = fixture('not-sealed.md', 'b\n');
    run(['seal', 'packages/web-astro/src/content/star/sealed-one.md'], { CONTENT_SEAL_KEY: KEY });

    expect(() =>
      run(['is-sealed', 'packages/web-astro/src/content/star/sealed-one.md'], { CONTENT_SEAL_KEY: KEY })
    ).not.toThrow();
    expect(() =>
      run(['is-sealed', 'packages/web-astro/src/content/star/not-sealed.md'], { CONTENT_SEAL_KEY: KEY })
    ).toThrow();
    expect(existsSync(other)).toBe(true);
  });

  it('status without a key reports the count but not the names', () => {
    fixture('secret-topic.md', 'a\n');
    run(['seal', 'packages/web-astro/src/content/star/secret-topic.md'], { CONTENT_SEAL_KEY: KEY });

    const output = execFileSync('node', [SCRIPT, 'status'], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CONTENT_SEAL_KEY')) as NodeJS.ProcessEnv,
    });
    expect(output).toContain('1 sealed file(s)');
    expect(output).not.toContain('secret-topic');
  });

  it('unseal-all is fatal with --require-key but only warns without it', () => {
    fixture('fork.md', 'a\n');
    run(['seal', 'packages/web-astro/src/content/star/fork.md'], { CONTENT_SEAL_KEY: KEY });

    const bare = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => k !== 'CONTENT_SEAL_KEY')
    ) as NodeJS.ProcessEnv;

    // The contract is the exit code — a fork build must survive. The warning
    // goes to stderr, which execFileSync does not return.
    const warned = execFileSync('node', [SCRIPT, 'unseal-all'], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      env: bare,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(warned).toBe('');

    expect(() =>
      execFileSync('node', [SCRIPT, 'unseal-all', '--require-key'], { cwd: REPO_ROOT, env: bare })
    ).toThrow();
  });
});
