# Requirements Role Output

## Objective
Ensure synced ICS events representing practices are classified as `practice` so Calendar filters and badges behave correctly.

## Current vs Proposed
- Current: ICS events default to game unless `ev.isPractice` is already set.
- Proposed: ICS parser marks practice-like summaries (`practice`, `training`, `skills club`) with `isPractice: true`.

## User Impact
- Coaches/parents can reliably filter to Practices and see synced practice events.
- Badges and labels match expected event type.

## Acceptance Criteria
- ICS event summary containing `Practice` is typed `practice` in calendar ingestion path.
- ICS event summary containing `Training` is typed `practice` in calendar ingestion path.
- Non-practice summaries remain non-practice.
- Regression test proves classification at parse level.

## Risk Surface
- Parser-level change affects ICS consumers globally.
- Blast radius limited to event typing metadata; date parsing and fetch logic unchanged.
