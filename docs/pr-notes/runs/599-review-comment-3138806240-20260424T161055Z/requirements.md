# Requirements

## Objective
Prevent schedule-change notifications from being sent to a stale counterpart team after a coach unlinks or replaces the opponent while editing a game.

## Acceptance Criteria
- Counterpart notification targeting is derived from the submitted game form state, not cached pre-edit linkage.
- If the linked opponent is cleared before save, no notification is sent to the old counterpart team.
- If a new linked opponent is selected before save, notifications target only that newly linked counterpart team.
- Same-team notification behavior for the editing team remains unchanged.

## Constraints
- Keep the patch minimal and local to the edit-schedule save flow.
- Preserve existing linked-opponent editing behavior and existing notification copy.
- Avoid introducing new cross-team leakage paths.

## Edge Cases
- Editing an older linked game and changing only the opponent text.
- Editing a linked game, removing the linked chip, then saving with notifications enabled.
- Editing a linked game and selecting a different linked opponent before save.
