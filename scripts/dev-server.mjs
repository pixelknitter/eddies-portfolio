#!/usr/bin/env node
/**
 * Start the Astro dev server, and actually start the one you asked for.
 *
 * ## The trap this exists to close
 *
 * `astro dev` daemonises and is a **singleton**. Start a second one and it does
 * not fail, does not warn in any way you would notice, and does not honour
 * `--port`: it prints "Dev server already running at http://localhost:4323" and
 * exits 0. Whatever you then open is served by the *first* daemon — built from
 * the environment that one was started with, which is how a run with
 * `PUBLIC_SHOW_RESUME=true` ends up 404ing every resume route. The flags were
 * real; they just went to a process that had already decided without them.
 *
 * It gets worse when the registry goes stale. A daemon whose pid is still alive
 * but is no longer listening leaves `astro dev start` insisting a server exists
 * while `astro dev status` says none does, and nothing on the port answers. The
 * only way out is to stop it, confirm the port, and start again — which is what
 * this does, every time, so nobody has to recognise the symptom first.
 *
 * Usage:
 *   yarn dev                       # port 4321
 *   yarn dev --port 4322
 *   yarn dev --all                 # every section flag on, plus fixtures
 *   yarn dev --port 4322 --all
 *
 * Any `PUBLIC_*` already in the environment is passed through and wins over
 * `--all`, so a one-off override still works.
 */

import { spawn, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(REPO, 'packages/web-astro');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? undefined : argv[at + 1];
};

const port = Number(value('port') ?? 4321);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`[dev] --port must be a port number, got: ${value('port')}`);
  process.exit(1);
}

const log = (...args) => console.log('[dev]', ...args);

/**
 * Everything the gated sections need to be reachable locally.
 *
 * Fixtures included deliberately: without the seal key the real content loads
 * zero entries, so a resume route would 404 and read as a broken build rather
 * than a missing secret.
 */
const ALL_SECTIONS = {
  PUBLIC_SHOW_BLOG: 'true',
  PUBLIC_SHOW_PROJECTS: 'true',
  PUBLIC_SHOW_RESUME: 'true',
  PUBLIC_SHOW_AIR: 'true',
  PUBLIC_SHOW_HIGHLIGHTS: 'true',
  PUBLIC_SHOW_FIXTURES: 'true',
};

/** Is anything answering on the port? */
async function isListening() {
  try {
    await fetch(`http://localhost:${port}/`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(1500),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop whatever `astro dev` thinks it is running, then make sure.
 *
 * Both steps are needed and neither is sufficient. `astro dev stop` is the
 * clean path and the only one that clears the registry, but it is a no-op
 * against a daemon the registry has already forgotten — and that daemon is
 * still holding the port. The sweep catches those; it matches on the command
 * line so it cannot touch an unrelated node process.
 */
function stopExisting() {
  spawnSync('npx', ['astro', 'dev', 'stop'], { cwd: APP, stdio: 'ignore' });

  const found = spawnSync('pgrep', ['-f', 'astro/astro.js dev'], {
    encoding: 'utf8',
  });
  const pids = (found.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (pids.length > 0) {
    log(`clearing ${pids.length} stray dev process(es)`);
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGTERM');
      } catch {
        // Already gone between listing and killing, which is the happy case.
      }
    }
  }
}

async function main() {
  stopExisting();

  // Give a stopping daemon a moment to release the port before the check below
  // decides someone else owns it.
  await new Promise((r) => setTimeout(r, 700));

  if (await isListening()) {
    console.error(
      `[dev] something is still answering on ${port} and it is not an astro dev\n` +
        `      server this script started. Find it with:  lsof -nP -iTCP:${port} -sTCP:LISTEN`,
    );
    process.exit(1);
  }

  const env = {
    ...(flag('all') ? ALL_SECTIONS : {}),
    // The caller's environment last, so an explicit override still wins.
    ...process.env,
  };

  log(`starting on ${port}${flag('all') ? ' with every section on' : ''}`);

  const child = spawn('npx', ['astro', 'dev', '--port', String(port)], {
    cwd: APP,
    env,
    stdio: 'inherit',
  });

  child.on('exit', (code) => process.exit(code ?? 0));

  // `astro dev` daemonises, so the parent exiting 0 proves nothing. Confirm the
  // port actually answers, and say so plainly if it never does.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isListening()) {
      log(`ready on http://localhost:${port}`);
      return;
    }
  }
  console.error(`[dev] nothing answered on ${port} within 60s`);
  process.exit(1);
}

main().catch((error) => {
  console.error('[dev]', error.message);
  process.exit(1);
});
