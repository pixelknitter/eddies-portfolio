#!/usr/bin/env node
/**
 * Point git at the repo's tracked hooks.
 *
 * `.git/hooks` is not version controlled, so a hook that only lives there
 * protects whoever happened to run the installer and nobody else. Setting
 * `core.hooksPath` makes the tracked directory authoritative, so the guard
 * travels with the repository.
 *
 * Run: yarn hooks:install
 */

import { execFileSync } from 'node:child_process';

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
  console.log('✓ git hooks installed from .githooks/');
  console.log('  pre-commit now refuses the plaintext of sealed content.');
} catch (error) {
  console.error(`✖ could not configure hooks: ${error.message}`);
  process.exit(1);
}
