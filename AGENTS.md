# ALL PLAYS Repository Instructions

This file is the canonical shared instruction set for coding agents in this
repository. `CLAUDE.md` imports it, Amazon Q adds reviewer-only rules in
`.amazonq/rules/allplays.md`, and narrower `AGENTS.md` files add directory
specifics. Architecture and CI evidence live in `docs/codebase/`.

## Product and Architecture

ALL PLAYS is a sports team-management and live-stat-tracking product with four
active runtime surfaces:

- Root `*.html`, `js/`, `css/`, and `img/`: the legacy static web product.
- `apps/app/`: the React/TypeScript app, hosted at `/app/` and packaged for iOS
  and Android through Capacitor.
- `functions/`: deployed Firebase Functions on Node 20.
- `services/chatgpt-mcp/`: a read-only, user-credentialed Node 22 MCP service.

The main Firebase project, `game-flow-c6311`, owns Auth, Firestore, Functions,
and Hosting. `game-flow-img` isolates image uploads. Firestore and Storage rules
are authorization boundaries, not optional client-side validation.

Read the relevant reference before a broad change:

- `docs/codebase/STACK.md`: runtimes, dependencies, commands, and config.
- `docs/codebase/STRUCTURE.md`: source boundaries and active entry points.
- `docs/codebase/ARCHITECTURE.md`: data flow and module responsibilities.
- `docs/codebase/CONVENTIONS.md`: code, errors, logging, and test conventions.
- `docs/codebase/INTEGRATIONS.md`: Firebase, Stripe, Resend, MCP, native, and CI.
- `docs/codebase/TESTING.md`: local test matrix and the complete CI/deploy graph.
- `docs/codebase/CONCERNS.md`: fragile areas and known architecture risks.
- `docs/landing-process.md`: external ownership and PaulBot landing handoff.

## Source Ownership

- Put legacy shared behavior in small ES modules under `js/`; reuse `js/utils.js`
  and existing Firebase helpers instead of copying page-local implementations.
- Put React routes in `apps/app/src/pages`, reusable UI in `components`, and
  business/data behavior in `apps/app/src/lib`.
- Keep web, iOS, and Android feature behavior shared. Native shells in `ios/`
  and `android/` should contain only platform configuration or thin adapters.
- Treat adapters in `apps/app/src/lib/adapters` as the compatibility boundary
  to legacy code. Search both the adapter and its legacy consumer before
  changing a shared payload or return type.
- Put deployed backend changes in `functions/`, whose active entry point is
  `functions/index.js`. Do not create an alternate Functions source tree.
- Put ChatGPT MCP work in `services/chatgpt-mcp/`. Application reads must remain
  user-credentialed and rules-enforced; the service identity is only for the
  isolated OAuth grant store.
- `_migration/` scripts are one-off privileged operations. Never run one against
  a real project without explicit authorization and a verified project target.
- `docs/pr-notes/runs/` is generated historical evidence. Do not scan or edit it
  unless the task specifically concerns a recorded automation run.

## Runtime and Package Manager

- Use Node 22 and npm 10+ for the root, React app, and MCP service. Firebase
  Functions deploy on Node 20.
- npm and `package-lock.json` are canonical in CI. Use `npm ci` for clean
  installs and `npm --prefix <directory> ...` for nested packages.
- Do not introduce a pnpm/Yarn lockfile or package-manager workspace.
  Dependency changes must update the applicable `package.json` and
  `package-lock.json` together.
- Do not hand-edit generated bundles, `node_modules`, Capacitor generated files,
  Playwright output, or `apps/app/bundle-visualizer.html`.

## Development Commands

```bash
# Install the same package sets CI uses
npm ci
npm ci --prefix apps/app
npm ci --prefix functions

# Legacy site and React app
python3 -m http.server 8000
npm run app:dev
npm run app:build

# Root unit/rules tests and React app tests
npm test
npm run test:unit:ci
npm --prefix apps/app run test:ci

# Focused examples
npx vitest run tests/unit/my-feature.test.js --reporter=verbose
npm --prefix apps/app exec -- vitest run src/lib/my-feature.test.ts --reporter=verbose
npm run test:smoke:team-fallback

# Native validation
npm run mobile:sync
npm run mobile:build:android
npm run mobile:build:ios
```

The legacy server defaults to `http://localhost:8000`; the app dev server uses
`http://localhost:5174`. Playwright defaults to a staged server at
`http://127.0.0.1:4173` and accepts `SMOKE_BASE_URL` and
`SMOKE_APP_BASE_URL` overrides.

## Change and Test Contract

Before editing, search producers, consumers, tests, rules, and deploy scripts
for the symbol, field, DOM ID, route, or config key being changed. This repo has
legacy and React implementations of many workflows; a change is incomplete if
only one active consumer understands the new contract.

| Change | Minimum focused validation |
| --- | --- |
| Legacy JS or static HTML | Root Vitest regression; smoke test for changed interaction or boot path |
| React helper/component/route | Co-located `apps/app/src/**/*.test.ts(x)`, app typecheck/build, focused app smoke for a user flow |
| Shared legacy/React contract | Tests for both producer and all active consumers |
| Firestore/Storage rules | Relevant emulator-backed rule test plus `npm run ci:firebase-rules` |
| Firebase Functions | Relevant `functions/test` suite; run auth, team-email, or notification command when touched |
| Runtime config/App Check | Config resolver tests, app build, and staged artifact/boot validation |
| Native plugin/config | App build, `npx cap sync`, and applicable native debug build |
| GitHub workflow/deploy script | YAML/shell syntax, referenced script tests, permissions/trust review, and exact path-filter behavior |
| Bug fix | A regression test that fails before the fix and passes after |

Use `readFileSync` contract tests for static pages when a browser is unnecessary.
Use `assertPageBootsWithoutFatalErrors` and the registry in
`tests/smoke/page-registry.js` for public legacy pages. Keep manual evidence in
the PR body when an interaction is not automated.

There is no repository-wide numeric coverage threshold. Do not claim coverage
completeness from a green run; use `npm run test:coverage-map` to check the
curated feature map and add focused regressions for changed behavior.

## Coding Conventions

- Legacy HTML/JS uses four-space indentation, semicolons, ES module imports,
  `camelCase` functions/variables, and DOM IDs aligned with field names.
- React/TypeScript follows `apps/app/.prettierrc.json`, strict TypeScript, and
  `apps/app/eslint.config.js`. Run the nested formatter/linter; there is no
  root-wide formatter that may rewrite the legacy site safely.
- Reuse `apps/app/src/lib/logger.ts` for app logging. It redacts tokens, keys,
  passwords, cookies, and email addresses. Never add raw credentials or
  personally identifiable data to logs, test artifacts, or PR comments.
- Normalize app service failures with `AppServiceError` helpers where the
  surrounding service already uses them; preserve user-safe messages and error
  causes for telemetry.
- Preserve critical legacy cache-bust query strings when changing imported
  assets; `scripts/check-critical-cache-bust.mjs` enforces selected updates.
- Prefer small, focused functions and PRs. Pull requests should normally stay
  below 500 changed lines and 20 files; explain or split larger changes.

## CI Flow

PR validation is intentionally split. Diagnose the failing stage instead of
restarting every run:

1. `ci.yml`: cache-bust guard, root/rules/function tests, app audit, typecheck,
   diff-aware lint, and app tests.
2. `regression-guards.yml`: Firebase deploy/rules guard and focused
   roster/chat/media/replay Playwright smoke.
3. `mobile-build.yml`: path-filtered Android and iOS builds, summarized by the
   stable fail-closed `mobile-build` context.
4. `preview-smoke.yml`: path-filtered staged web/app smoke and visual tests,
   summarized by the stable fail-closed `preview-smoke` context.
5. `deploy-preview.yml` creates an untrusted, credential-free PR artifact.
   `deploy-preview-trusted.yml` verifies the run, PR, artifact, and current head
   from trusted default-branch code before OIDC and Firebase preview deployment.
6. `app-github-pages.yml` validates the staged web bundle on PRs; deployment is
   disabled unless the repository variable or manual input explicitly enables it.

After merge, `deploy-prod.yml` retests and builds a commit-bound artifact, then
obtains production credentials only in the protected deploy job. It deploys
changed rules/indexes before application components and fails closed.
`post-deploy-smoke.yml`, `scheduled-prod-smoke.yml`,
`critical-workflow-health.yml`, and `firestore-recovery-health.yml` monitor the
result.

Do not merge the untrusted and trusted preview workflows, add OIDC or secrets to
PR-code jobs, execute downloaded artifact code in a privileged job, loosen
exact-SHA checks, or replace SHA-pinned third-party actions with mutable tags.
These are security boundaries, not workflow ceremony.

Canceled runs on an obsolete SHA are expected. Always bind review, checks, and
remediation to the current PR head. A green result for an older commit is not
evidence for a newer one.

## External Ownership and PaulBot Handoff

PaulBot is the landing controller; coding sessions are producers.
Treat “ready for review” as the controller handoff event.
Landing latency starts at the latest ready exact head, not when an early draft
was opened.

1. Add `external-claim` to both the issue and PR before an outside human, Codex,
   Claude, or Q session starts writing.
2. Keep the PR draft and keep `external-claim` while commits or review fixes are
   still being produced.
3. Before handoff, make the worktree clean, run focused validation, finish the
   PR title/body/evidence, push the final commit, and verify the exact remote
   head SHA.
4. Mark ready and remove `external-claim` only when that exact head is frozen.
   This is the controller handoff and the start of landing latency.
5. After handoff, do not push, amend, force-push, rebase, merge, toggle
   auto-merge, or launch a competing remediation session. PaulBot owns review,
   branch update, required checks, and merge.
6. Before handoff, the current producer may restore `external-claim` when code
   must change, then make a new commit, rerun focused validation, and perform a
   new exact-head handoff. After handoff, an external coding session must not
   restore the label or reclaim remediation merely because PaulBot found an
   issue. Only an explicit operator-requested ownership transfer may return the
   PR to an external producer; otherwise PaulBot remains the sole writer.

`external-claim` is controller ownership metadata, not a CI trigger. PR
workflows run on code-head lifecycle events and must not restart or cancel for
label churn. At handoff PaulBot consumes the frozen exact head's existing
results; if applicable current-head checks are missing or canceled, the
controller narrowly wakes or reruns them.

Amazon Q review is also commit-specific. A subsequent push does not
automatically repeat Q's GitHub review; request `/q review` on the new frozen
head when Q is part of the landing policy.

## Commit, PR, and Security Requirements

- Use short, imperative, sentence-case commits. Do not amend a handed-off head.
- PR bodies need a change/why summary, tests actually run, affected pages or
  routes, manual steps, and screenshots/clips for visible UI changes.
- Report draft age separately from landing age; do not describe draft
  development time as merge-controller latency.
- Never commit service-account keys, private API keys, Stripe/Resend secrets,
  OAuth encryption keys, signing certificates, provisioning profiles, or
  keystores. Public Firebase client config is expected.
- Never bypass `isAdmin`, team ownership/admin, parent, verified-email,
  entitlement, or App Check policy in client code.
- Use the root `firebase.json`, `firestore.rules`, `firestore.indexes.json`, and
  `storage.rules` as the only deployment configuration.
- Direct production deploys, migrations, issue/PR mutations, ready-state
  changes, and merges require the explicit workflow or ownership authorization
  described above.
