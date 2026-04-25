# Requirements

## Objective
Ensure shared schedule notifications attempt all intended team chat targets, even if one target write fails.

## Acceptance Criteria
- A failure posting to one notification target does not stop attempts for remaining targets.
- If at least one target receives the notification, the schedule update is treated as sent for metadata purposes.
- A full failure is surfaced only when every target post fails.
- Existing cancellation behavior remains consistent.

## Constraints
- Keep the patch minimal and local to schedule notification dispatch.
- Preserve existing notification copy and target deduplication.
- Avoid masking complete notification outages.

## Edge Cases
- Current team chat succeeds but counterpart team chat is blocked by Firestore rules.
- First target fails and second target succeeds.
- All targets fail due to network or permission issues.
