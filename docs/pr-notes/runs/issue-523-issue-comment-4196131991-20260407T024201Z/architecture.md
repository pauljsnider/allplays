## Current State
- `team.html` composes schedule cards from mixed calendar events and Firestore game docs.
- DB event normalization previously dropped CTA-driving fields like `id`, `liveStatus`, and metadata used by the schedule card.
- Cancelled DB games could still win next-game selection or render conflicting upcoming/live affordances.
- Focused regression coverage for the agreed state matrix was missing.

## Proposed State
- Normalize DB games once at `getAllEvents()` so downstream schedule rendering receives a complete event shape, including `id`, `gameId`, `liveStatus`, metadata fields, and derived `isCancelled`.
- Treat cancelled as fail-closed across next-game selection, upcoming filtering, and schedule-card CTA rendering.
- Derive schedule-card UI from normalized status values so upcoming, live, completed, replay, and tie behavior stays deterministic.
- Keep the change local to `team.html` and focused unit tests.

## Key Decisions
- Normalize once at the page boundary instead of changing Firestore schema or upstream writers.
- Carry explicit `isCancelled` rather than repeating raw string checks across filters.
- Suppress live/upcoming CTA paths when cancelled.
- Use the repo’s actual default branch, `master`, for the PR target because the active worktree is based on `origin/master`.

## Blast Radius
- User-visible impact is limited to the team-page schedule card, next-game countdown selection, and upcoming filtering.
- No backend, auth, rules, or permission changes.

## Rollback
- Revert the `team.html` normalization, filtering, and renderer changes.
- Remove the two Issue #523 regression test files if needed.
