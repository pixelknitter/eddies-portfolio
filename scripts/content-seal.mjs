#!/usr/bin/env node
/**
 * Seal pending content and stage the result.
 *
 * ## Why this exists as a command rather than only a hook
 *
 * The working copies in `.local-*​/` are gitignored, so editing one produces no
 * git-visible change at all. `git commit` then has nothing to do, the
 * pre-commit hook never fires, and the edit silently never ships — the vault
 * still holds the old text and a deploy publishes it.
 *
 * Sealing is what turns a content edit into something committable: the vault is
 * tracked, so a reseal is the change git can see. That makes it an explicit
 * step in the writing workflow, not a side effect of committing something else.
 *
 * The hook remains as a backstop for the case where you *do* have other changes
 * staged — it stops the vault drifting behind the working copies — but it can
 * never be the primary path, because the primary path has nothing to hook onto.
 *
 * Usage: yarn content:seal
 */

import { execFileSync } from 'node:child_process';

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe' });

try {
  const output = run('node', ['scripts/seal-content.mjs', 'seal']);
  process.stdout.write(output);

  if (output.includes('sealed and current')) {
    console.log('\nNothing to commit.');
    process.exit(0);
  }

  // Stage the vault so the next commit carries it. Staging rather than
  // committing keeps the message yours.
  run('git', ['add', 'packages/web-astro/content-vault']);
  const staged = run('git', ['diff', '--cached', '--name-only', 'packages/web-astro/content-vault'])
    .split('\n')
    .filter(Boolean);

  console.log(`\nStaged ${staged.length} vault file(s). Commit and push to publish:`);
  console.log('  git commit -m "content: update sealed posts"');
} catch (error) {
  const message = error.stderr?.toString() || error.message;
  console.error(message.trim());
  process.exit(1);
}
