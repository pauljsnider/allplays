# Playwright Coverage Plan (2 Weeks)

Date: 2026-02-21
Owner: Engineering (AllPlays)

## Objective
Ship reliable, repeatable browser automation for critical user journeys with CI enforcement in 2 weeks.

## Current State
- Manual test guides exist (`PR-TESTING-GUIDE.md`, feature task docs).
- No automated Playwright suite was previously wired into the repo.
- High-risk flows depend on browser + Firebase behavior (Auth, Firestore, role-gated UI).
- No unit-test harness is currently wired for shared JS modules.

## Proposed State
- Playwright runs in CI and locally.
- Critical-path smoke and regression suites cover auth, role isolation, scheduling/tracking, and practice workflows.
- Test data is deterministic via Firebase Emulator + seed fixtures.
- Unit tests cover extracted pure logic (stat math, routing decisions, validation helpers) with fast feedback.

## Risk Surface and Blast Radius
- Multi-tenant/role mistakes can expose cross-team data and parent/player details.
- Auth regressions can block all users from login/signup.
- Scheduling/tracker regressions break game-day operations.
- If tests are flaky or non-deterministic, trust in CI drops and coverage becomes noise.

## Assumptions
- Team can run Firebase Emulator locally/in CI.
- Test accounts and fixture team data can be provisioned safely (no production data).
- We can keep first-wave suite under ~10 minutes to protect PR velocity.

## Recommendation
Prioritize integration coverage in chunks: high-risk, high-frequency flows first; lower-risk paths second.

Tradeoff:
- This delays broad long-tail coverage, but it sharply reduces risk in auth/data isolation and game-day workflows.

## Unit Test Strategy

### Problem We Are Solving
Catch pure-logic regressions quickly without requiring full browser + emulator startup.

### Tooling
- Runner: `vitest`
- Environment:
  - `node` for pure utilities
  - `jsdom` only where minimal DOM interaction is needed
- Coverage: `@vitest/coverage-v8`

### Scope (what to unit test first)
- `js/utils.js`: date/time formatting, parsing, guards, mapping helpers
- `js/db.js` extracted helpers: query option normalization, payload validation/sanitization helpers
- Tracker logic (`track*.html`/`js/live-game.js`) after extraction into testable modules:
  - stat aggregation math
  - period/clock transformations
  - tracker route decision helpers

### Scope (what not to unit test)
- Firebase SDK internals
- Cross-page browser flows already covered by Playwright
- Tailwind/UI layout behavior

### Design Rule to Make Unit Testing Work
- New logic goes into small exported modules under `js/lib/` with no direct `document` access.
- Pages call these modules; modules are unit-tested directly.

### Quality Gates
- Unit tests run on every PR (`<2 min` target).
- Playwright smoke runs on every PR.
- Critical Playwright suite runs on PR (or required nightly until stable).

### Coverage Targets by 2026-03-06
- Unit: >= 80% on targeted helper modules introduced/extracted during this plan window.
- Integration (Playwright): >= 70% of P0/P1 user journeys.

## Scope by Chunk (10 Working Days)

### Chunk 1: Foundation + Smoke (Day 1-2)
- Done in this change:
  - Playwright project scaffolding
  - Local static web server integration in config
  - First smoke test (`tests/smoke/homepage.spec.js`)
- Remaining:
  - CI workflow for smoke on PR
  - Artifact retention (HTML report, traces on failure)

Success metric:
- `test:e2e:smoke` passes locally and in CI on every PR.

### Chunk 2: Authentication + Access Control (Day 3-4)
- Automate:
  - Email/password login happy path
  - Google sign-in redirect guardrails (where testable in emulator/stub mode)
  - Signup code required path (accept/reject)
  - Parent vs coach vs admin navigation access checks
- Include negative tests for unauthorized page access and forbidden UI actions.

Success metric:
- 0 unresolved auth/access regressions reach main after rollout.

### Chunk 3: Team + Schedule + Tracker Routing (Day 5-6)
- Automate:
  - Team create/edit basics
  - Schedule track-button routing (basketball modal vs direct standard tracker)
  - Calendar-originated game track flow
- Validate UI + persisted state transitions.

Success metric:
- 100% pass rate for routing regression pack across 20 consecutive runs.

### Chunk 4: Practice Command Center + Parent Workflow (Day 7-8)
- Automate:
  - Drill CRUD (community/custom/favorites where feasible)
  - Practice session linkage from schedule
  - Attendance persistence
  - Parent packet completion and coach visibility rollup

Success metric:
- Replaces current manual pass/fail checklist for these flows.

### Chunk 5: Security/Isolation + Stabilization (Day 9-10)
- Add isolation assertions:
  - Cross-team data not visible to non-members
  - Parent limited profile edit boundaries
  - Role-gated admin actions
- Stabilize:
  - Remove flaky selectors
  - Add deterministic waits/fixtures
  - Tag suites (`@smoke`, `@critical`, `@extended`)

Success metric:
- Critical suite runtime <= 10 minutes; flaky rate < 2%.

## Daily Plan (2 Weeks)

### Week 1
- Day 1 (2026-02-23): finalize test architecture and CI shape
  - [x] Confirm suite taxonomy: `@smoke`, `@critical`, `@extended`
  - [x] Add CI job for `test:e2e:smoke`
  - [x] Add artifacts upload (report/trace on fail)
- Day 2 (2026-02-24): seed deterministic test data
  - [ ] Create base fixture users (admin/coach/parent)
  - [ ] Create base fixture team + schedule entries
  - [ ] Validate emulator reset/seed script repeatability
- Day 3 (2026-02-25): auth integration tests
  - [ ] Login happy path
  - [ ] Signup code accept/reject path
  - [ ] Unauthorized route blocking checks
- Day 4 (2026-02-26): access-control integration tests
  - [ ] Parent/coach/admin nav and action visibility assertions
  - [ ] Negative checks for forbidden actions
  - [ ] Add stable test ids/selectors where needed
- Day 5 (2026-02-27): schedule/tracker routing integration tests
  - [ ] Basketball chooser modal decision path
  - [ ] Non-basketball direct route path
  - [ ] Calendar-originated game track path

### Week 2
- Day 6 (2026-03-02): unit test harness + first unit set
  - [ ] Add `vitest` config + scripts
  - [ ] Add unit tests for `js/utils.js` pure helpers
  - [ ] Enforce pass in CI
- Day 7 (2026-03-03): extract and unit-test tracker logic
  - [ ] Extract stat math helpers to `js/lib/`
  - [ ] Add unit tests for aggregation/clock edge cases
  - [ ] Add fixtures for overtime/empty-stats edge cases
- Day 8 (2026-03-04): practice + parent integration tests
  - [ ] Drill CRUD happy path
  - [ ] Practice attendance persistence path
  - [ ] Parent packet completion + coach visibility rollup
- Day 9 (2026-03-05): security/isolation hardening
  - [ ] Cross-team data visibility negative tests
  - [ ] Parent edit-boundary tests
  - [ ] Admin-only operation guard tests
- Day 10 (2026-03-06): stabilization and release criteria
  - [ ] Flake triage + quarantine list
  - [ ] Ensure critical runtime <= 10 minutes
  - [ ] Publish summary metrics + remaining backlog

## Nightly Throughput Targets (Automation)
- New-test quota per nightly run: 10-20 tests
- Preferred nightly target: 12 tests
- Warning threshold: below 10 tests added (non-blocking)
- Pacing: one checklist item batch per night into rolling PR
- Two-week output goal: at least 140 net new tests

## Trackable Task List (Master Checklist)

### Foundation
- [x] Playwright scaffold in repo
- [x] First smoke test passing locally
- [x] CI smoke gate enabled (`.github/workflows/playwright-smoke.yml`)
- [x] Nightly CI run enabled (`.github/workflows/playwright-nightly.yml`)
- [x] Smoke test hardened — removed Firebase-dependent assertion, added `@smoke` tag
- [x] `playwright.config.js` — CI-aware retries, workers, and reporter
- [x] `data-testid` selector convention documented in `docs/playwright-setup.md`

### Integration (Playwright)
- [x] Auth + signup guardrails suite complete
- [x] Role/access-control suite complete
- [x] Schedule/tracker routing suite complete
- [x] Practice + parent workflow suite complete
- [x] Security/isolation negative suite complete

### Unit Tests
- [ ] `vitest` harness and coverage configured
- [ ] `js/utils.js` unit tests complete
- [ ] Extracted tracker logic unit tests complete
- [ ] Query/payload helper unit tests complete

### Reliability and Reporting
- [ ] Suite tags and shard strategy finalized
- [ ] Flake rate under 2%
- [ ] Runtime targets met
- [ ] Weekly evidence report published

## Coverage Targets by End of Week 2
- Critical-path Playwright coverage: >= 70% of defined P0/P1 user journeys.
- Unit coverage: >= 80% of targeted extracted helper modules.
- PR gate: smoke + critical suite required.
- Nightly run: full extended suite with report artifact.

## Instrumentation and Evidence
- Track:
  - Pass/fail trend by suite
  - Flake rate per spec
  - Median runtime per suite
  - Escaped defects mapped to missing/failed tests
- Store:
  - HTML report
  - Trace/video on failures
  - CI job links in release notes for major feature drops

## Rollback Plan
- If suite instability blocks delivery:
  - Gate PRs on smoke only temporarily
  - Move unstable specs to nightly quarantine list
  - Keep manual checklist in parallel for affected flows until stable

## Owners, Dates, Outcomes
- Owner: AllPlays engineering lead for rollout orchestration
- Support:
  - Feature owners for fixture and selector hardening
  - QA partner for checklist tracking and evidence capture
- Deadline: 2026-03-06 (two-week mark)
- Outcomes:
  - Repeatable automation for high-risk workflows
  - Fast unit guardrails for core business logic
  - Lower escaped regression rate
  - Auditable evidence for auth/access controls
