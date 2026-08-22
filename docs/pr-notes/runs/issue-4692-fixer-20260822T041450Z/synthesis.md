# Acceptance Criteria

Render at most five newest completed public games with opponent, date, current-team-first score, and Win/Loss/Draw. Show distinct loading, empty, and unavailable states. Preserve all existing exclusions and narrow-screen usability.

# Architecture Decisions

Use only `getPublicTeamGamesProjection`. Reuse one completed-game normalizer for standings and results. Keep results supplemental so projection failure does not hide a valid public profile. Do not add endpoints or privileged fallbacks.

# QA Plan

Test filtering, ordering, bounding, team perspective, empty/unavailable states, stale-route clearing, browser module exports, and 390px overflow. Run focused Vitest, app component, Playwright, and typecheck commands.

# Implementation Plan

Write tests first, confirm they fail for the missing selector/UI, implement the minimal service and component changes, then rerun the focused checks.

# Risks And Rollback

Primary risks are privacy-filter drift, stale route state, incorrect team perspective, and mobile overflow. Shared normalization, isolated state, focused regressions, and the smoke stub guard mitigate them. Rollback is a source-only revert with no schema or data action.

# Conflict Resolution

- Chose five as the concrete bound proposed by Requirements and Architecture.
- Chose a non-fatal results error, resolving the Requirements open question in favor of preserving profile availability.
- Chose current-team-first scores and recomputed outcomes rather than trusting projection result text.
- Added the targeted browser smoke update because QA identified a real named-export and mobile-overflow regression surface.
