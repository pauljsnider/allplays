# Issue #516 Architecture Synthesis

## Architecture Decisions
- Keep RSVP docs as the source of truth and `games/{gameId}.rsvpSummary` as derived state.
- Preserve latest-write-wins precedence per player.
- Reduce drift by sharing the same per-player latest-response reducer between summary recomputation and game-day breakdown rendering.

## Data And Precedence Model
- Resolve player IDs from `playerIds`, then legacy fields, then fallback mappings when needed.
- Evaluate overlap per player, not per document.
- Filter summary counts to the active roster.
- Allow game-day breakdown to keep former-player rows while using the same precedence rule.

## Minimal Patch Shape
- Extract shared latest-by-player RSVP selection into `js/rsvp-summary.js`.
- Reuse that helper in `js/game-day-rsvp-breakdown.js`.
- Add tests that mirror real parent and coach doc shapes.

## Risks And Rollback
- Main risk is changing precedence semantics unintentionally.
- Full rollback is a simple revert of the shared-helper refactor and tests.
- No schema, rules, or data migration changes are required.
