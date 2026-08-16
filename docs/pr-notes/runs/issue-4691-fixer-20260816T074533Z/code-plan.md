# Execution Plan

## Acceptance Criteria

- Render public-safe native standings for enabled teams with qualifying games.
- Preserve configured ranking behavior through exact config handoff.
- Highlight only the current team.
- Render specific loading, empty, disabled, and unavailable states with an optional league link.
- Prevent narrow-card overflow without horizontal clipping.

## Architecture Decisions

- Keep profile and standings state independent so secondary data cannot block or erase identity content.
- Add only a narrow native computation export to the existing public-team adapter.
- Do not modify `js/native-standings.js`, authenticated `TeamDetail`, Functions, rules, or public payloads.
- Use a fixed-layout full-width table with explicit column widths and wrapping team names.
- Treat a failed complete projection as unavailable, never as authoritative empty standings.

## QA Plan

- Write focused component regressions before implementation.
- Verify exact native-engine inputs/config, anonymous table rendering, ranking-specific metric, highlight, failure isolation, league fallback, disabled behavior, and mobile layout classes.
- Run the nearest app test, then the app build for compiler/import failures.

## Implementation Plan

1. Extend the public-team adapter with a typed `computeNativeStandings` export.
2. Extend `PublicTeamDetail` state/effect to load and compute enabled standings after profile success.
3. Add the responsive standings section and small local formatting helpers.
4. Keep every async state update behind the existing route cancellation guard.
5. Run focused tests and app build, then commit all product, test, and role-artifact changes.

## Risks And Rollback

- Name-based current-row matching can miss a renamed row; it will fail safe with no highlight.
- JSDOM proves structural responsiveness, not real pixel layout; retain a 320px post-deploy check.
- Rollback is one commit because the change is read-only and introduces no schema or backend changes.

## Conflict Resolution

- QA and code-role drafts suggested horizontal overflow containment. Architecture identified that scrolling conflicts with the explicit no-clipping mobile criterion. The chosen table uses `table-fixed w-full`, explicit compact column widths, and a wrapping team cell, so page-level and table-level horizontal scrolling are unnecessary.
- A standings-specific retry button was considered but omitted from this narrow slice. The profile remains usable, the message is actionable, and the configured league link provides a fallback without expanding state complexity.

## Root Cause

The public profile never consumed the sanitized standings inputs introduced by #4690 and had no standings state or renderer, so the existing native computation was unreachable from the public route.

## Prevention / Learning

When a public-safe data slice is introduced for a UI feature, add a consumer-level regression that proves the target route invokes the boundary, passes configuration unchanged to shared domain logic, and independently handles loading, empty, and error states.

## Regression Tests

- Focused `PublicTeamDetail` component tests covering the exact missing route-to-engine-to-table workflow and its unavailable states.
- Existing native standings tests remain the ranking behavior guardrail.

## Recurrence Risk

Low. The new component tests fail if the public route stops loading sanitized inputs, drops configuration, loses highlighting, or removes fallback behavior; the native engine is unchanged.

## Commit Message Draft

`Add public team profile standings (#4691)`
