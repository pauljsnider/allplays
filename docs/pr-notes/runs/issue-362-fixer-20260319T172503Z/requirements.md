# Issue 362 Requirements

## Objective
Add behavioral coverage for Edit Team admin access persistence so admin add/remove flows cannot silently regress authorization on the next load.

## Current State
- `edit-team.html` rebuilds `adminEmails` client-side and submits the full array through `updateTeam`.
- Existing coverage only verifies shared access-helper wiring and adjacent dashboard affordances.
- Stored admin emails can arrive with casing, whitespace, or duplicates from older writes and manual fixes.

## Proposed State
- Behavioral tests exercise load, mutate, save, and reload for Edit Team admin management.
- Saved `adminEmails` are normalized before persistence so the next load reflects the intended access set.

## Risk Surface
- Blast radius is team-management authorization for coaches/admins.
- Failure mode is silent access loss or stale access retention after Edit Team saves.

## Assumptions
- A unit-level behavioral harness is acceptable here because the runtime cannot launch Playwright browsers in this environment.
- Minimal hardening around normalization is acceptable if it directly protects access persistence.

## Recommendation
Cover the workflow end to end and normalize admin email arrays at the boundary where Edit Team loads/saves and where access checks read them.
