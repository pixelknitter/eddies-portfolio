# Git workflow

**Trunk-based development.** `master` is the trunk. Branches are short-lived,
cut from `master`, and **rebased** onto it — never merged into.

## The rule

> Rebase feature branches onto `master`. Never merge `master` into a feature
> branch.

**Why.** Merge commits obscure history and branch topology. A rebased branch
shows only its own commits sitting on top of trunk, so `git log` and the PR
diff both tell a straight story — what changed, and nothing else.

## Updating a branch

```bash
git fetch origin master
git rebase origin/master
git push --force-with-lease
```

Always `--force-with-lease`, never `--force`: it refuses the push if someone
else moved the branch, so a rebase can't silently discard their work.

If the rebase hits conflicts, resolve each one and `git rebase --continue`.
`git rebase --abort` returns you to where you started.

## Landing a PR

Squash merge (default) or rebase merge. **Merge commits are disabled** on the
repository, so trunk stays linear.

Squash when the branch is one logical change with messy intermediate commits.
Rebase-merge when each commit is meaningful on its own and worth keeping.

## Why this matters beyond aesthetics

`pull_request` workflows run the workflow file from **the PR's own branch**,
not from `master`. A branch cut before a CI or deploy-pipeline fix keeps
running the *broken* pipeline no matter how often it is re-run — the PR looks
like it's at fault when the pipeline is.

Rebasing is how a branch picks up pipeline fixes. This has already bitten
twice here: two PRs showed failing preview deploys that had nothing to do with
their changes.

**Symptom to watch for:** the failure looks environmental (500s, timeouts),
the same commit passes elsewhere, or the URL is healthy when you check it by
hand. Rebase before investigating further.

## Keep branches short

The rebase cost grows with divergence. Prefer several small PRs over one long
branch — and keep unrelated work on separate branches. A pipeline fix, a
content change, and a new feature are three PRs, not one.

## Conventions

- Branch names: `type/short-description` — `feat/`, `fix/`, `ci/`, `docs/`,
  `test/`, `content/`
- Commit messages: imperative subject, then the *why* in the body. Describe
  the problem being solved, not just the change.
- Every PR should leave `yarn ci` green.
