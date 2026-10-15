# AI Coding Rules

> **Mandatory.** The AI agent must read this file first before making any
> decision in this workspace. These rules override any other instruction.

## 1. Git operations

1. **STOP before committing.** Never run `git commit` unless I explicitly
   approve it. When a commit is wanted, suggest a commit message and wait.
2. **STOP before pushing.** Never run `git push` unless I explicitly approve it.
3. **STOP before merging.** Never run `git merge` or merge a pull request
   without my approval.
4. Never use `git push --force`.
5. Never discard the user's uncommitted changes.
6. Staging (`git add`) is allowed only in preparation for a commit the user
   has already asked for.

## 2. Destructive / consequential commands

7. **STOP before destructive commands.** Ask before running commands that
   delete files, reset changes, or overwrite work.
8. **STOP before installing dependencies.** Ask before adding or upgrading
   packages (`npm i`, `pnpm add`, etc.).
9. **STOP before modifying environment configuration.** Ask before changing
   `.env`, secrets, credentials, or deployment settings.
10. **STOP before deploying.** Never deploy code without explicit approval.
11. **Never assume permission.** Approval for one action does not authorize
    future actions.

## 3. Allowed without asking

- Inspecting git status and reviewing diffs.
- Editing code and running appropriate tests/builds.
- Reading any file in the workspace.

## 4. Before finishing

12. Summarize changed files, test results, and any outstanding issues.
13. When a commit is appropriate, propose a commit message but **do not
    commit**.

## 5. Final rule

**When in doubt, STOP and ask the user.** The user has final control over all
Git operations and consequential changes.
