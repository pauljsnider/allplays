# Architecture

## Decision
Keep Firebase preview pruning inside `deploy-preview`, but replace brittle raw REST pagination with `gh pr list --repo <repo> --state open --limit 200 --json number` and guard the discovery command.

## Why
This is the smallest CI-only change that removes the observed JSON parsing failure from the deploy path while preserving current Firebase preview-channel cleanup behavior.

## Blast Radius
- Touched file: `.github/workflows/deploy-preview.yml`.
- Runtime app impact: none.
- Firebase data impact: none.
- Firebase Hosting impact: limited to PR preview channels named `pr-*`.
- Production hosting: not targeted.

## Controls
- Active `CURRENT_CHANNEL` remains explicitly skipped.
- Open PR channels remain skipped.
- If GitHub PR discovery fails, pruning exits successfully before any delete attempt, avoiding accidental deletion from an empty open-channel set.
- Existing 404-safe delete handling remains unchanged.

## Rollback
Revert the workflow command change. No data rollback required.
