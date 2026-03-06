# Requirements role (fallback synthesis)

## Objective
Ensure RSVP summaries remain mathematically correct when a coach overrides one child from a parent RSVP that includes multiple children.

## User-visible failure
- Parent marks two children as `going` in one RSVP doc.
- Coach overrides one child to `not_going` via per-player controls.
- Summary can become wrong if one child is counted twice or sibling status is dropped.

## Expected behavior
- Each roster player contributes to exactly one summary bucket.
- A coach override replaces only that player's prior state.
- Sibling players from the original parent RSVP remain represented.

## Constraints
- Minimal patch; avoid broad RSVP refactors.
- Preserve existing parent + coach workflows.
- Keep denormalized game `rsvpSummary` updates intact.

## Acceptance criteria
- Regression test covers parent multi-player RSVP + coach single-player override.
- Summary after override is consistent (no over-counting, no sibling loss).
- Existing RSVP summary unit tests still pass.
