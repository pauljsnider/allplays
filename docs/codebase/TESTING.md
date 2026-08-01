# Testing Patterns and CI Flow

## 1) Test Stack and Commands

- Primary unit/component framework: Vitest 4.1 with native assertions and
  `vi.fn()`/`vi.mock()`.
- Browser framework: Playwright 1.62 with Chromium.
- Rules integration: Firebase Firestore/Storage emulators using project
  `demo-allplays`.
- Function tests: Vitest and Node's built-in test runner, depending on suite.
- App DOM setup: jsdom and Testing Library through
  `apps/app/src/setupTests.ts`.

```bash
# Root legacy/static/cross-surface unit tests
npm test

# Root tests plus emulator-backed security suites
npm run test:unit:ci

# React app co-located unit/component tests
npm --prefix apps/app run test:ci

# Focused examples
npx vitest run tests/unit/my-feature.test.js --reporter=verbose
npm --prefix apps/app exec -- vitest run src/lib/my-feature.test.ts --reporter=verbose

# Browser suites
npm run test:smoke
npm run test:smoke:team-fallback
npm run test:smoke:visual

# Coverage/quality signals
npm --prefix apps/app run test:coverage
npm run test:coverage-map
```

## 2) Test Layout

- `tests/unit/`: legacy module tests, HTML/file contracts, cross-surface
  contracts, deploy scripts, Firebase rules, and operational helpers.
- `apps/app/src/**/*.test.ts(x)`: React services, adapters, helpers, components,
  routes, startup, and app shell behavior.
- `functions/test/`: Function core behavior, notification, email, payment,
  calendar, and integration-boundary tests.
- `tests/smoke/*.spec.js`: legacy/app boot, authenticated workflows, visual
  fixtures, candidate/production checks, and targeted regressions.
- `tests/smoke/page-registry.js`: public legacy page inventory.
- `tests/smoke/helpers/boot-path.js`: standard fatal-error boot assertion.
- `playwright.smoke.config.js`: base URL, UTC timezone, deterministic visual
  settings, Chromium project, and limited retry quarantine.
- `vitest.config.ts`: root dependency aliases/worktree resolution and test scope.

Root file-contract tests should prefer `readFileSync` when no browser is needed.
App component/service tests use jsdom and module mocks. Rules tests start clean
emulators and must never target a real Firebase project.

## 3) Test Scope Matrix

| Scope | Covered? | Typical target | Notes |
| --- | --- | --- | --- |
| Unit | Yes | Pure JS/TS logic, parsers, helpers, services | Root and app suites |
| Component | Yes | React screens, hooks, error/loading UI | Co-located under app `src` |
| Static contract | Yes | HTML structure, IDs, links, config/workflow files | Fast root Vitest without browser |
| Rules integration | Yes | Firestore/Storage authorization boundaries | Emulator-backed, Java 21 in CI |
| Functions integration/core | Yes | Email, notifications, payments, calendars | Mostly local core with mocked boundaries |
| Local E2E/smoke | Yes | Legacy and React boot/user flows | Playwright against staged/local servers |
| Visual regression | Yes | Deterministic legacy/app views | Linux snapshots and manual baseline workflow |
| Native compile | Yes | Android debug and iOS simulator | Path-filtered GitHub jobs |
| Production smoke | Yes | Candidate headers/auth and live `/app/`/legacy routes | Post-deploy and scheduled workflows |

## 4) Change-to-Test Matrix

| Change | Required reasoning and validation |
| --- | --- |
| Root HTML or legacy JS | Find shared consumers; focused root test; boot or interaction smoke if user-visible |
| React route/helper/component | Co-located app test; typecheck/build; focused smoke for flow changes |
| Legacy adapter/shared payload | Test both the legacy producer and every React/native consumer |
| Firestore/Storage rules | Relevant emulator test and `npm run ci:firebase-rules` |
| Functions | Owning Function test plus auth/team-email/notification suite when applicable |
| App runtime config/App Check | Resolver tests, production app build, staged artifact boot |
| Native plugin/config | App build, Capacitor sync, applicable native build |
| CI/deploy workflow | Parse/syntax check, referenced script tests, event/path/permissions/trust analysis |
| Bug fix | A focused failing-before/passing-after regression |

## 5) Pull Request CI Graph

### Fast and focused validation

`pr-fast.yml` is the single fast pull-request code-head entrypoint and calls
the reusable `ci.yml` workflow:

- `cache-bust-guard`: verifies selected legacy asset query-version updates.
- `unit-tests`: installs root, Functions, and app packages; validates optional
  performance evidence; runs root/rules tests and notification/auth/team-email
  coverage.
- `app-quality`: audits app production dependencies, typechecks, performs
  diff-aware lint, and runs app tests.

`pr-integration.yml` is the single integration code-head entrypoint. It calls
the reusable `regression-guards.yml`, which runs:

- `firebase-rules-deploy-guard`: `npm run ci:firebase-rules`.
- `roster-chat-media-replay-smoke`: focused Playwright fallback regression.

### Expensive path-filtered integration

The same `pr-integration.yml` run calls `mobile-build.yml`, which classifies
changes. App, native, Capacitor, root manifest,
lockfile, or workflow changes run Android debug and iOS simulator jobs. The
stable aggregate job named `mobile-build` passes when native work is not
applicable and fails closed on classification or native failures.

It also calls `preview-smoke.yml`, which classifies served-web impact. Backend, native, docs,
migration, root unit-test, and rule-only diffs may skip heavy work. Applicable
changes build/stage the root plus app, start static and app servers, and run
nonvisual and deterministic visual Playwright suites. The stable aggregate job
named `preview-smoke` passes a valid not-applicable skip and fails closed on
inconsistent classification or smoke failure.

These aggregate names are the stable branch-protection signals. Check their
dependency jobs before treating a green skip as an executed native/browser run.

### Preview security split

`deploy-preview.yml` runs only for same-repository PRs and has empty
permissions. It checks regression gates and builds an untrusted Hosting
artifact without Google credentials.

`deploy-preview-trusted.yml` runs from `workflow_run` using trusted
default-branch verifier code. It validates the triggering workflow, PR,
artifact name/content, and exact current head; safely extracts content, creates
a trusted Firebase config, and creates a sanitized handoff. Only the deploy job
then obtains OIDC and writes the fixed `pr-N` preview channel. Reporting checks
that the head is still current.

Never check out or execute PR code in the OIDC job. Never replace this pair with
`pull_request_target`, loosen artifact validation, or let a stale head publish.

`app-github-pages.yml` also builds and bundle-checks the staged root plus app.
Its deploy job runs only when an explicit repository variable or manual input
enables it.

## 6) Landing and Exact-Head Interpretation

- Outside writers keep `external-claim` while developing and freeze the final
  exact SHA before ready-state handoff.
- PaulBot owns post-handoff current-head review, at most one landing-branch
  update, required checks, and merge.
- Obsolete-SHA checks may be canceled by workflow concurrency. This is normal;
  a canceled old run is not a current-head failure.
- A green check from an earlier SHA cannot satisfy review or remediation for a
  newer SHA.
- Amazon Q GitHub review does not automatically repeat after a push. Request
  `/q review` if the changed frozen head requires Q review.
- `external-claim` is controller metadata; applicable workflows deliberately
  do not listen for label changes. Handoff consumes the frozen head's existing
  results. If a current-head check is missing or canceled, confirm PaulBot
  narrowly woke or reran that check before waiting.

## 7) Post-Merge and Production CI

`deploy-prod.yml` runs on `master` push or manual dispatch:

1. Root/rules/function tests and focused regression smoke run first.
2. A credential-free job builds the app and exact-commit deploy handoff.
3. It detects rules, indexes, Storage, and backfill changes.
4. The protected deploy job validates the handoff before OIDC.
5. Changed Firestore rules/indexes deploy before application components and
   block later deploys on failure.
6. Hosting and Functions deploy with bounded transient retries; optional
   backfills run only under their explicit change/dispatch conditions.

`post-deploy-smoke.yml` validates a successful exact-master deployment against
candidate and production routes. `scheduled-prod-smoke.yml` runs every 15
minutes. `critical-workflow-health.yml` and
`firestore-recovery-health.yml` run every six hours and reconcile durable
incident issues.

Manual workflows cover candidate-host deployment, signed mobile release, and
visual baseline generation.

## 8) Coverage and Quality Signals

- App coverage uses V8 through `npm --prefix apps/app run test:coverage`.
- No numeric global threshold is configured in the app or root test config.
- `tests/coverage/feature-coverage-map.json` is a curated feature map checked by
  `npm run test:coverage-map`; it is not a statement-level coverage percentage.
- The root suite is large, and Playwright/native jobs are expensive. Use focused
  tests during development, then the applicable full producer preflight.
- One deterministic auth visual path has a limited CI retry quarantine;
  otherwise smoke retries are intentionally minimal.

## 9) Failure Triage

1. Confirm the PR's current head SHA and the failing run's SHA.
2. Identify whether the failure is fast test, rule guard, app quality, path
   classifier, native child, stable aggregate, preview build, trusted deploy, or
   post-merge deploy/smoke.
3. Read the first real failing step and its uploaded artifact/log; do not rerun
   all workflows to hide a deterministic failure.
4. Treat npm/Gradle/SwiftPM retries as transient only when the final attempt
   shows transport/dependency symptoms rather than compile/test errors.
5. Reclaim with `external-claim` before writing a fix. Push a new commit, rerun
   focused validation, and hand off the new exact head once.

## 10) Evidence

- `package.json`
- `vitest.config.ts`
- `apps/app/vite.config.ts`
- `apps/app/src/setupTests.ts`
- `playwright.smoke.config.js`
- `tests/smoke/page-registry.js`
- `.github/workflows/ci.yml`
- `.github/workflows/pr-fast.yml`
- `.github/workflows/pr-integration.yml`
- `.github/workflows/regression-guards.yml`
- `.github/workflows/mobile-build.yml`
- `.github/workflows/preview-smoke.yml`
- `.github/workflows/deploy-preview.yml`
- `.github/workflows/deploy-preview-trusted.yml`
- `.github/workflows/deploy-prod.yml`
- `docs/landing-process.md`
