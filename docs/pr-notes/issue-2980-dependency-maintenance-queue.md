# Issue #2980: Dependency Maintenance Queue

Draft PR anchor for #2980.

## Current Finding

The issue was opened from a dependency maintenance scan, but follow-up triage found
that `package.json` and `package-lock.json` already carry the versions listed in
the scan output. A stale local `node_modules` tree can still make
`npm outdated` report work that is not a repository-level dependency delta.

## Implementation Scope

- Re-run dependency maintenance from a clean install or CI checkout.
- Compare `package.json` and `package-lock.json` against the scan snapshot before
  changing dependency ranges.
- If any package is genuinely behind the wanted/latest version, update both the
  manifest and lockfile in this branch.
- If no package delta exists, close the issue with the verified no-op evidence
  instead of forcing a dependency-only churn commit.

## Acceptance

- `npm outdated --json` has been checked from a clean dependency state.
- Any real dependency changes are committed with the matching lockfile changes.
- If no changes are needed, the issue is closed with the clean-scan evidence.

## Validation

- `npm install` or `npm ci`
- `npm outdated --json`
- `npm test` if package versions change
