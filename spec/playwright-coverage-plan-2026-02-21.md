# Playwright Coverage Plan (2 Weeks)

Date: 2026-02-21
Owner: Engineering (AllPlays)

## Objective
Ship reliable, repeatable browser automation for critical user journeys with CI enforcement in 2 weeks.

## Current State
- Manual test guides exist (`PR-TESTING-GUIDE.md`, feature task docs).
- No automated Playwright suite was previously wired into the repo.
- High-risk flows depend on browser + Firebase behavior (Auth, Firestore, role-gated UI).

## Proposed State
- Playwright runs in CI and locally.
- Critical-path smoke and regression suites cover auth, role isolation, scheduling/tracking, and practice workflows.
- Test data is deterministic via Firebase Emulator + seed fixtures.

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

## Coverage Targets by End of Week 2
- Critical-path Playwright coverage: >= 70% of defined P0/P1 user journeys.
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
- Support: feature owners for fixture and selector hardening
- Deadline: 2026-03-06 (two-week mark)
- Outcomes:
  - Repeatable automation for high-risk workflows
  - Lower escaped regression rate
  - Auditable evidence for auth/access controls
