import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, rmSync, readdirSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join, relative, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';

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
// A temp vault, never the real one. This previously pointed at
// packages/web-astro/content-vault and was rmSync'd in beforeEach, so running
// the tests deleted every sealed file in the repository.
const VAULT = mkdtempSync(join(tmpdir(), 'seal-vault-'));
// Fixtures live outside the content root. `seal` takes an explicit path and
// does not care where the file is, so there is no reason to put test files
// where Astro's recursive glob will treat them as real content — and where the
// A.I.R. eval spec, which reads the same directory, raced against them.
const FIXTURE_DIR = mkdtempSync(join(tmpdir(), 'seal-spec-'));
const CONTENT = FIXTURE_DIR;
const CONTENT_REL = relative(REPO_ROOT, FIXTURE_DIR);
const KEY = 'a memorable passphrase for tests';

function run(args: string[], env: Record<string, string> = {}) {
  return execFileSync('node', [SCRIPT, ...args], {
    // Point the script at the temp vault for every invocation.
    env: { ...process.env, CONTENT_VAULT_DIR: VAULT, ...env },
    encoding: 'utf8',
    cwd: REPO_ROOT,
  });
}

/**
 * A key-less environment that still points at the temp vault. Dropping
 * CONTENT_SEAL_KEY by filtering process.env used to drop the vault override
 * too, so the script fell back to the real vault and reported its contents.
 */
function keylessEnv(): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k !== 'CONTENT_SEAL_KEY')
  ) as NodeJS.ProcessEnv;
  env.CONTENT_VAULT_DIR = VAULT;
  return env;
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
    run(['seal', `${CONTENT_REL}/ticketfly-android-launch.md`], {
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
    run(['seal', `${CONTENT_REL}/a.md`], { CONTENT_SEAL_KEY: KEY });
    // Blobs sit in one flat vault, not under star/ or blog/.
    expect(existsSync(join(VAULT, readdirSync(VAULT).find((f) => f.endsWith('.sealed'))!))).toBe(true);
  });

  it('round-trips content and its path', () => {
    const original = '---\ntitle: Round trip\n---\n\nBody with émoji 🎉 and\ttabs.\n';
    const path = fixture('round-trip.md', original);
    run(['seal', `${CONTENT_REL}/round-trip.md`], { CONTENT_SEAL_KEY: KEY });

    // Sealing clears the collection path — that is build output, and leaving
    // it there is what `audit` flags as committed plaintext — while leaving an
    // editable working copy in the gitignored .local- directory.
    expect(existsSync(path)).toBe(false);
    const working = join(dirname(path), `.local-${basename(dirname(path))}`, 'round-trip.md');
    expect(readFileSync(working, 'utf8')).toBe(original);

    run(['unseal-all'], { CONTENT_SEAL_KEY: KEY });
    expect(readFileSync(path, 'utf8')).toBe(original);
  });

  // Deterministic naming keeps diffs stable — re-sealing must not churn the
  // vault with a new blob every time.
  it('names a given path the same way every time', () => {
    fixture('stable.md', 'one\n');
    run(['seal', `${CONTENT_REL}/stable.md`], { CONTENT_SEAL_KEY: KEY });
    const first = readdirSync(VAULT).filter((f) => f.endsWith('.sealed'))[0];

    run(['unseal-all'], { CONTENT_SEAL_KEY: KEY });
    run(['seal', `${CONTENT_REL}/stable.md`], { CONTENT_SEAL_KEY: KEY });
    const after = readdirSync(VAULT).filter((f) => f.endsWith('.sealed'));

    expect(after).toHaveLength(1);
    expect(after[0]).toBe(first);
  });

  it('accepts an ordinary passphrase, not just base64 key material', () => {
    const path = fixture('phrase.md', 'content\n');
    run(['seal', `${CONTENT_REL}/phrase.md`], {
      CONTENT_SEAL_KEY: 'correct horse battery staple',
    });
    run(['unseal-all'], { CONTENT_SEAL_KEY: 'correct horse battery staple' });
    expect(readFileSync(path, 'utf8')).toBe('content\n');
  });

  it('refuses a wrong key rather than emitting garbage', () => {
    fixture('wrong-key.md', 'content\n');
    run(['seal', `${CONTENT_REL}/wrong-key.md`], { CONTENT_SEAL_KEY: KEY });
    expect(() => run(['unseal-all'], { CONTENT_SEAL_KEY: 'a different passphrase' })).toThrow();
  });

  it('rejects a tampered blob', () => {
    fixture('tamper.md', 'content\n');
    run(['seal', `${CONTENT_REL}/tamper.md`], { CONTENT_SEAL_KEY: KEY });

    const blob = join(VAULT, readdirSync(VAULT).find((f) => f.endsWith('.sealed'))!);
    const envelope = JSON.parse(readFileSync(blob, 'utf8'));
    envelope.data = Buffer.from('tampered').toString('base64');
    writeFileSync(blob, JSON.stringify(envelope));

    expect(() => run(['unseal-all'], { CONTENT_SEAL_KEY: KEY })).toThrow();
  });

  it('rejects an empty passphrase', () => {
    fixture('empty-key.md', 'content\n');
    expect(() =>
      run(['seal', `${CONTENT_REL}/empty-key.md`], { CONTENT_SEAL_KEY: '   ' })
    ).toThrow();
  });

  // What the pre-commit hook asks. It must answer for one path without
  // revealing any other.
  it('answers is-sealed by exit code', () => {
    fixture('sealed-one.md', 'a\n');
    const other = fixture('not-sealed.md', 'b\n');
    run(['seal', `${CONTENT_REL}/sealed-one.md`], { CONTENT_SEAL_KEY: KEY });

    expect(() =>
      run(['is-sealed', `${CONTENT_REL}/sealed-one.md`], { CONTENT_SEAL_KEY: KEY })
    ).not.toThrow();
    expect(() =>
      run(['is-sealed', `${CONTENT_REL}/not-sealed.md`], { CONTENT_SEAL_KEY: KEY })
    ).toThrow();
    expect(existsSync(other)).toBe(true);
  });

  // The rule that turns sealing from a habit into a guarantee. `check` asks
  // whether a sealed file's plaintext leaked; `audit` asks the inverse — is
  // anything unpublished sitting in the repo unsealed at all.
  describe('audit', () => {
    const bare = keylessEnv();

    // Runs with no key at all — that is what lets it enforce on fork pull
    // requests, where `check` can only report.
    it('reports actionably, with or without anything to report', () => {
      let output: string;
      let failed = false;
      try {
        output = execFileSync('node', [SCRIPT, 'audit'], { cwd: REPO_ROOT, env: bare, encoding: 'utf8' });
      } catch (error) {
        failed = true;
        output = String((error as { stderr?: Buffer }).stderr ?? '');
      }

      if (failed) {
        // Naming the file is not enough — it has to say why and what to run.
        expect(output).toMatch(/draft: true|publishDate/);
        expect(output).toContain('node scripts/seal-content.mjs seal');
      } else {
        expect(output).toContain('none unpublished in plaintext');
      }
    });
  });

  it('status without a key reports the count but not the names', () => {
    fixture('secret-topic.md', 'a\n');
    run(['seal', `${CONTENT_REL}/secret-topic.md`], { CONTENT_SEAL_KEY: KEY });

    const output = execFileSync('node', [SCRIPT, 'status'], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      env: { ...keylessEnv() } as NodeJS.ProcessEnv,
    });
    expect(output).toContain('1 sealed file(s)');
    expect(output).not.toContain('secret-topic');
  });

  it('unseal-all is fatal with --require-key but only warns without it', () => {
    fixture('fork.md', 'a\n');
    run(['seal', `${CONTENT_REL}/fork.md`], { CONTENT_SEAL_KEY: KEY });

    const bare = keylessEnv();

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
