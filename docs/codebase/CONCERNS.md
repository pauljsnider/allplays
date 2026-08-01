# Codebase Concerns

This is a risk map, not a claim that every listed concern is currently causing
a production incident. Churn observations use repository history available on
2026-07-25.

## 1) Top Risks

| Severity | Concern | Evidence | Impact | Suggested action |
| --- | --- | --- | --- | --- |
| High | Legacy/React/native contract drift | `js/`, `apps/app/src/lib/adapters/`, parallel services | A field or policy works on one surface and fails on another | Search and test every producer/consumer before changing a contract |
| High | Very large authorization/data/backend files | `firestore.rules` ~4.1k lines, `js/db.js` ~9.9k, `functions/index.js` ~14.8k | Wide blast radius and slow review | Extract tested helpers incrementally; avoid unrelated edits |
| High | Privileged CI depends on exact trust boundaries | Preview pair and `deploy-prod.yml` | A careless workflow simplification can execute untrusted input with cloud access | Preserve permissions, pinned actions, artifact validation, exact SHA, and OIDC ordering |
| High | Landing behavior spans repo policy and external PaulBot controller | `docs/landing-process.md`, workflow triggers | Label/check state can stall if controller and docs diverge | Make controller observations explicit and validate exact-head transitions |
| Medium | Configuration inventory is fragmented | No `.env.example`; config spread across README, runbooks, functions, workflows | Missed variables and unsafe local/production assumptions | Add an integration-owned config inventory without secret values |
| Medium | No numeric repository-wide coverage gate | Test configs and package scripts | Green suites can miss an unlisted contract path | Use risk-based regressions and maintain the feature coverage map |

## 2) Technical Debt

| Debt item | Why it exists | Where | Risk if ignored | Suggested fix |
| --- | --- | --- | --- | --- |
| Monolithic legacy data module | Product grew around a shared static-site Firebase layer | `js/db.js` | Conflicts and subtle cross-page regressions | Extract feature modules behind compatibility exports |
| Monolithic Functions entry | Many integrations accumulated in one deployed CommonJS file | `functions/index.js` | Slow review, cold-start/import coupling, duplicate error policy | Move tested cores into focused modules while preserving exports |
| Large schedule service | React parity work accumulated in one service | `apps/app/src/lib/scheduleService.ts` | Frequent conflicts and hard consumer analysis | Split by read/write/import/calendar/game-day concerns |
| Large security rules | One file encodes many roles and products | `firestore.rules` | Policy changes are hard to reason about | Expand rule helper tests and modularize only within Firebase-supported constraints |
| Generated history in primary docs tree | Automation records every run | `docs/pr-notes/runs/` | Discovery noise and repository growth | Define retention/archive policy and exclude from routine scans |
| Root tooling inconsistency | Legacy code predates app toolchain | Root vs `apps/app` configs | Style drift and no automated legacy lint | Add narrowly scoped checks rather than mass formatting |

## 3) Security Concerns

| Risk | OWASP category | Evidence | Current mitigation | Gap |
| --- | --- | --- | --- | --- |
| Authorization bypass from client-only checks | A01 Broken Access Control | `firestore.rules`, `storage.rules`, client access helpers | Server-enforced rules and emulator suites | Large policy surface requires consumer-specific regression tests |
| PR artifact privilege escalation | A08 Software/Data Integrity | preview workflow pair | Empty PR permissions, trusted verifier, sanitized handoff, exact SHA, OIDC afterward | Future workflow edits can accidentally collapse the boundary |
| Secret/PII leakage in diagnostics | A02 Cryptographic Failures / privacy | `logger.ts`, MCP OAuth flows | Recursive redaction and encrypted/digested grant storage | Legacy/Functions direct logging is not uniformly centralized |
| Over-privileged MCP service identity | A01 Broken Access Control | MCP README and `oauthStore.js` | Isolated grant DB, user-credentialed app reads, production fail-closed checks | IAM configuration lives outside repo and needs periodic audit |
| App Check misconfiguration | A05 Security Misconfiguration | runtime config and rollout runbook | Staged enforcement and production debug-token guards | Host allowlists and console state are external |
| Privileged migration misuse | A01/A05 | `_migration/` | Manual scripts and documentation | No universal dry-run/project confirmation wrapper |

## 4) Performance and Scaling Concerns

| Concern | Evidence | Current symptom | Scaling risk | Suggested improvement |
| --- | --- | --- | --- | --- |
| Repeated package installs in separate jobs | PR workflow YAML | Longer CI and network sensitivity | More checks increase landing latency | Share only safe caches/artifacts; retain trust separation |
| macOS iOS dependency/build work | `mobile-build.yml` | Expensive, slower native validation | App/lockfile changes trigger both platforms | Keep accurate path filters and stable aggregate; measure p50/p95 |
| Full staged Playwright plus visual suite | `preview-smoke.yml` | Browser install and broad smoke cost | More pages increase feedback time | Maintain browser cache and split only with stable fail-closed aggregation |
| Large app/data modules | Bundle visualizer and high-line-count services | Increased parse/bundle/review cost | Feature growth worsens startup and conflicts | Use route/dynamic imports and incremental service extraction |
| Broad real-time Firestore listeners | `onSnapshot` patterns in legacy/app services | Potential read/listener growth | Team/game activity can multiply reads | Profile per feature before changing query/listener behavior |

The existing workflow retries for npm, Gradle, SwiftPM, and Firebase deploys
help with transient infrastructure failures. More retries are not a substitute
for fixing deterministic tests, compiler failures, or controller contention.

`[TODO]` This documentation pass did not perform an endpoint-by-endpoint N+1 or
sequential-call performance audit. Profile a specific workflow before claiming
that parallel calls, caching, or listener changes are safe.

## 5) Fragile and High-Churn Areas

| Area | Why fragile | Churn signal | Safe change strategy |
| --- | --- | --- | --- |
| `js/db.js` | Shared legacy persistence contract | About 234 commits touching it in the prior 90-day history scan | Search every export consumer; add contract regression |
| `functions/index.js` | Many privileged integrations in one entry | About 160 touches in the same scan | Change one integration core; run targeted Function tests |
| `firestore.rules` | Common authorization boundary | About 171 touches | Add emulator allow/deny tests before rule edit |
| `scheduleService.ts` | Broad React schedule/game behavior | About 121 touches | Test all affected adapters/routes and avoid unrelated cleanup |
| `edit-schedule.html` | Large legacy workflow page | About 103 touches | Preserve DOM IDs/imports/cache bust; unit plus smoke |
| `parent-dashboard.html` | Large auth-sensitive parent workflow | About 109 touches | Verify parent privacy/rules and boot/user-flow smoke |
| `ScheduleEventDetail.tsx` | Central high-feature app route | About 91 touches | Keep service logic out of component; focused component and route tests |
| Deploy/preview workflows | Shell, GitHub expressions, artifacts, OIDC | Security-sensitive rather than line-count-sensitive | Review event, permissions, input trust, exact SHA, and cleanup as one system |

## 6) Resolved Decisions

The repository owner delegated these decisions on 2026-07-25:

1. `ALL PLAYS` is the canonical product name.
2. The unreferenced Angular/alternate-Functions prototype is removed rather
   than maintained as a second apparent implementation.
3. npm and `package-lock.json` are the only package-manager contract.
4. `external-claim` remains controller ownership metadata. Label changes do not
   trigger CI; PaulBot consumes or narrowly restores applicable checks for the
   frozen exact head.

## 7) Intent-vs-Reality Divergences

- Older agent instructions placed React helper tests in root `tests/unit`, but
  the active app has a large co-located `apps/app/src/**/*.test.ts(x)` suite and
  CI runs it separately. `AGENTS.md` now reflects the implementation.
- Landing ownership is controller state while CI is repository state. This is
  intentional: PR workflows observe code-head events, not label churn, and
  PaulBot binds handoff decisions to the exact head SHA.

## 8) Evidence

- `git log --since=90.days --name-only` history inspection on 2026-07-25
- `AGENTS.md`
- `README.md`
- `docs/landing-process.md`
- `package.json`
- `apps/app/package.json`
- `firebase.json`
- `js/db.js`
- `functions/index.js`
- `apps/app/src/lib/scheduleService.ts`
- `firestore.rules`
- Commit `d31bf31b3` / PR #4190
- `.github/workflows/mobile-build.yml`
- `.github/workflows/preview-smoke.yml`
- `.github/workflows/deploy-preview-trusted.yml`
- `.github/workflows/deploy-prod.yml`
