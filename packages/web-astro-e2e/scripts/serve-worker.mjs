/**
 * Runs `wrangler dev` for the E2E suite and brings it back if it dies.
 *
 * ## Why this exists
 *
 * `wrangler dev` exits partway through a run, intermittently. Its internal
 * ProxyWorker raises an error carrying no message, and `ProxyController`
 * escalates any ProxyWorker error to fatal — so the process ends and every test
 * still to come fails with ERR_CONNECTION_REFUSED against a dead port. The
 * signature and the evidence are in docs/RUNBOOK.md.
 *
 * It is upstream, it is not the application, and it has taken out runs on
 * master as readily as on feature branches. Playwright's `webServer` starts a
 * command once and never restarts it, so a single upstream hiccup used to cost
 * the whole suite. This supervises that command instead.
 *
 * A restart is not free: requests in flight during the gap still fail, and the
 * suite leans on Playwright's `retries` to absorb them. What it buys is that
 * the run continues at all rather than reporting several dozen failures that
 * say nothing about the change under test.
 *
 * ## Usage
 *
 * Every argument is forwarded to `wrangler dev` verbatim:
 *
 *     node ../web-astro-e2e/scripts/serve-worker.mjs -c dist/server/wrangler.json --port 4321
 *
 * Run from `packages/web-astro`, which is the cwd playwright.config.ts sets.
 */
import { spawn } from 'node:child_process';
import { connect } from 'node:net';

/**
 * Restarts allowed before giving up. A healthy run needs none. More than a
 * couple means something other than the known flake is wrong, and continuing to
 * respawn would only bury the real error under a slow-motion timeout.
 */
const MAX_RESTARTS = Number(process.env.E2E_SERVER_MAX_RESTARTS ?? 5);

/**
 * Wrangler exiting this fast *on the very first attempt* means it never came
 * up — a bad config or a port already taken, which restarting cannot fix.
 *
 * The check is deliberately limited to the first attempt. A restart racing the
 * dying server for the port also exits within a second or two, and treating
 * that as unrecoverable would defeat the entire point of this script.
 */
const HEALTHY_AFTER_MS = 10_000;

/** How long to wait for the port to come free before respawning anyway. */
const PORT_RELEASE_TIMEOUT_MS = 20_000;

const args = process.argv.slice(2);

const portFlag = args.indexOf('--port');
const port = portFlag === -1 ? 4321 : Number(args[portFlag + 1]);

let child;
let restarts = 0;
let everServed = false;
let stopping = false;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Resolves true while something is still listening on the port. */
function portBusy() {
  return new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' })
      .on('connect', () => {
        socket.destroy();
        resolve(true);
      })
      .on('error', () => resolve(false));
    socket.setTimeout(1_000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * workerd is a *grandchild*: wrangler spawns it, and when wrangler dies on the
 * ProxyWorker error it does not always take it with it. An orphan holds the
 * port, the respawn fails with EADDRINUSE, and the restart accomplishes
 * nothing. The child gets its own process group precisely so the whole tree can
 * be reaped by group id here.
 */
function reap(pid) {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // Already gone, which is the outcome we wanted.
  }
}

async function waitForPort() {
  const deadline = Date.now() + PORT_RELEASE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!(await portBusy())) return true;
    await sleep(500);
  }
  return false;
}

function start() {
  const startedAt = Date.now();
  const attempt = restarts;

  // `npx` rather than a resolved path: it is what the config used before this
  // script existed, and it keeps working under Yarn's node-modules linker.
  //
  // `detached` puts wrangler and its workerd children in their own process
  // group, so `reap()` can kill the tree without killing this supervisor.
  child = spawn('npx', ['wrangler', 'dev', ...args], {
    stdio: 'inherit',
    detached: true,
  });

  const pid = child.pid;

  child.on('error', (error) => {
    console.error(`[serve-worker] could not spawn wrangler: ${error.message}`);
    process.exit(1);
  });

  child.on('exit', async (code, signal) => {
    if (stopping) return;

    const alive = Date.now() - startedAt;
    if (alive >= HEALTHY_AFTER_MS) everServed = true;
    const how = signal ? `signal ${signal}` : `code ${code}`;
    const fail = () => process.exit(code === 0 ? 1 : (code ?? 1));

    if (attempt === 0 && !everServed) {
      console.error(
        `[serve-worker] wrangler exited after ${alive}ms (${how}) without ever serving — ` +
          `a startup failure, not the ProxyWorker flake. Not restarting.`,
      );
      return fail();
    }

    if (restarts >= MAX_RESTARTS) {
      console.error(
        `[serve-worker] wrangler exited (${how}) after ${MAX_RESTARTS} restarts. Giving up.`,
      );
      return fail();
    }

    restarts += 1;
    // ::warning:: so it is visible in the Actions summary even on a run that
    // ends green — a restart still means the flake happened, and a run that
    // quietly papered over three of them should not look identical to a clean
    // one.
    console.error(
      `::warning::[serve-worker] wrangler exited (${how}) after ${Math.round(alive / 1000)}s ` +
        `— restarting (${restarts}/${MAX_RESTARTS}). See "E2E fails with a wall of ` +
        `ERR_CONNECTION_REFUSED" in docs/RUNBOOK.md.`,
    );

    reap(pid);
    if (!(await waitForPort())) {
      console.error(
        `[serve-worker] port ${port} still held after ${PORT_RELEASE_TIMEOUT_MS}ms; ` +
          `restarting anyway.`,
      );
    }

    if (!stopping) start();
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
    if (child?.pid) reap(child.pid);
    process.exit(0);
  });
}

start();
