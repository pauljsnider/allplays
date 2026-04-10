# Requirements Role Summary

## Objective
Prevent stale period/clock restore when live event documents include pending `serverTimestamp()` values (`createdAt: null`) during resume.

## Current State
Resume logic trusts latest `createdAt` whenever at least one timestamped event exists, ignoring untimestamped events.

## Proposed State
Resume logic must include untimestamped valid events in mixed datasets and avoid regressing to an older game position.

## Risk Surface and Blast Radius
- Scope: resume initialization path only (`deriveResumeClockState`).
- User impact: incorrect period/clock on resume can mislead coaches/parents and create stat/log drift.
- Data risk: no schema/rules changes, read-only derivation logic.

## Acceptance Criteria
1. Mixed timestamped + untimestamped events restore to latest plausible game position.
2. Existing behavior for fully timestamped datasets remains unchanged.
3. Existing fallback behavior for no valid events remains unchanged.
