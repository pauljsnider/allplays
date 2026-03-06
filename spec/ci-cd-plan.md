# CI/CD Plan (Tests + Firebase Deploys)

## Objective

Create a reliable CI/CD process for this repo so every PR is validated by automated tests and production deploys happen only after all required checks pass.

## Current State

- Unit tests exist under `tests/unit/*.test.js` and use Vitest imports.
- Firebase Hosting/Functions/Firestore config exists (`firebase.json`, `firestore.rules`, `functions/`).
- No GitHub workflow files are present yet.
- Root `package.json` is not present, so CI test commands are not centralized at repo root.

## Scope

In scope:

- CI for pull requests and `main` branch pushes.
- Preview deploys for PRs.
- Production deploy from `main`.
- Branch protection and required status checks.
- Basic cost guardrails for GitHub Actions and Firebase.

Out of scope (phase 1):

- End-to-end browser automation.
- Full Firestore emulator contract test harness.
- Blue/green or multi-region deployment orchestration.

## Target Pipeline

1. PR opened/updated:
- Run unit tests (`vitest`) in CI.
- If tests pass, deploy a Firebase Hosting preview channel and post URL on PR.

2. Merge to `main`:
- Run unit tests again on `main`.
- If tests pass, deploy to production Firebase project (`game-flow-c6311`).

3. Optional later gate:
- Manual approval in GitHub Environment before production deploy.

## Implementation Plan

### Phase 1: Baseline CI (Required)

1. Add root `package.json` with:
- `devDependencies`: `vitest`
- scripts:
  - `test:unit`: `vitest run tests/unit`
  - `test:unit:ci`: `vitest run tests/unit --reporter=dot`

2. Add `.github/workflows/ci.yml`:
- Trigger: `pull_request`, `push` to `main`
- Steps:
  - Checkout
  - Setup Node 20
  - `npm ci`
  - `npm run test:unit:ci`

3. Configure branch protection on `main`:
- Require PR before merge
- Require `ci` workflow status check
- Require branch up to date before merge

### Phase 2: PR Preview Deploys

1. Add `.github/workflows/deploy-preview.yml`:
- Trigger: `pull_request`
- `needs: ci` (or equivalent test job)
- Deploy Hosting preview channel `pr-<number>` using Firebase Hosting GitHub Action.
- Post preview URL in PR comment.

2. Restrict paths to avoid unnecessary preview deploys (optional):
- Only run when app files/config change (HTML/CSS/JS/firebase files).

### Phase 3: Production CD

1. Add `.github/workflows/deploy-prod.yml`:
- Trigger: `push` on `main`
- Run/require unit tests.
- Deploy `hosting` first.

2. After stability window (1-2 weeks), extend deploy step to:
- `firestore:rules`
- `firestore:indexes`
- `functions` (if production-ready and tested)

3. Add `concurrency` to prevent overlapping production deploys.

## Secrets and Permissions

Required secrets:

- `FIREBASE_SERVICE_ACCOUNT_GAME_FLOW_C6311` (service account JSON with least privilege).

Recommended permissions:

- Use GitHub OIDC to Firebase/GCP in later phase to reduce long-lived key usage.
- Limit who can approve production environment (if approval gate enabled).

## Cost and Usage Guardrails

1. GitHub Actions:
- Public repos are typically free on standard runners.
- Private repos have included minutes/storage limits; monitor usage monthly.

2. Firebase:
- Preview channels and Hosting traffic can consume quota.
- Keep preview retention short (e.g., auto-expire channels).
- Start with hosting-only prod deploy to reduce function deploy/runtime surprises.

3. CI runtime:
- If test suite grows, shard tests in matrix to reduce wall-clock time.
- Cache npm dependencies to reduce repeated install time and cost.

## Validation and Rollout Checklist

1. Open test PR that intentionally fails one unit test and verify merge is blocked.
2. Fix test and verify:
- CI turns green.
- Preview URL is posted.
3. Merge to `main` and verify production deploy completes.
4. Confirm site health on key routes:
- `index.html`
- `login.html`
- `dashboard.html`
- `track-live.html`
5. Document rollback command and owner:
- `firebase hosting:rollback` (or redeploy previous known-good commit).

## Success Criteria

- Every PR has automated unit-test status before merge.
- Preview URL is available on PRs for quick manual verification.
- Production deploys only happen from `main` after tests pass.
- Team can identify deploy owner, rollback path, and current pipeline status in under 5 minutes.

## Future Enhancements

- Add smoke tests for key pages after deploy.
- Add Firestore emulator rules tests as a separate CI job.
- Add deployment notifications (Slack/email) on failure/success.
- Add scheduled dependency update checks with controlled auto-merge policy.
