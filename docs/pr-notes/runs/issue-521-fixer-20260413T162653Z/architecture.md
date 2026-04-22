# Current state
`js/live-tracker.js` prompts to resume when scores, opponent stats, or live flags exist. On the start-over branch it reset game metadata and deleted `events` plus `aggregatedStats`, but it did not clear `liveEvents`. That left one persisted source able to repopulate stale live state on reopen. The branch also left some in-memory game fields stale.

# Proposed minimal approach
Patch only the start-over branch in `init()`.
- Fetch `liveEvents` alongside `events` and `aggregatedStats`.
- Delete all three collections in the reset branch.
- Reset in-memory tracker/game state needed for the immediate render: scores, opponent stats, lineup, and clock metadata.
- Keep opponent linkage fields untouched.

# Data/control invariants
- Destructive reset applies only after the coach chooses Cancel on the resume prompt.
- Opponent identity fields survive reset.
- Reset event broadcast remains a single canonical `type: 'reset'` message.
- Resume branch behavior is unchanged.

# Risks
- Over-resetting linked opponent fields would break opponent context.
- Forgetting a persisted collection would allow stale state to rehydrate.
- Broader refactor in tracker init would increase blast radius.

# Recommended implementation notes
- Keep the patch local to the existing `!shouldResume` block.
- Add a targeted harness test that exercises the real init/reset flow by stubbing Firestore helpers and `confirm()`.
- Assert both persistence cleanup and rendered score state to cover data plus UI outcome.
