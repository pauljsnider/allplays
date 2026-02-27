# Architecture Role Output

## Current-State Read
Invite processing is split between `edit-team.html` (new team form flow and queue state) and `js/edit-team-admin-invites.js` (batch processing). Current implementation normalizes emails and does per-email error handling, but pending queue reset is tied to success path sequencing in the submit handler.

## Proposed Design
- Keep invite processing in `processPendingAdminInvites`.
- Add stricter malformed-result handling by treating non-object/invalid responses as missing code fallback for non-existing users.
- Move pending queue clear in `edit-team.html` to a `finally` path around invite processing invocation so state reset is guaranteed.
- Preserve existing UI/redirect flow and no new storage/state layers.

## Files And Modules Touched
- `edit-team.html`
- `js/edit-team-admin-invites.js`
- `tests/unit/edit-team-admin-invites.test.js`

## Data/State Impacts
- In-memory `pendingAdminInviteEmails` lifecycle becomes deterministic after each create-team submission attempt.
- Summary result may include additional fallback entries for malformed invite responses.

## Security/Permissions Impacts
- No access model changes.
- Defensive handling reduces accidental leakage of broken invite workflow state, but does not alter auth/rules boundaries.

## Failure Modes And Mitigations
- Invite backend returns malformed payload: handled via fallback path, no runtime throw.
- Partial invite failure: per-email status retained; save flow continues and surfaces follow-up alert.
- Re-submit after failure: queue is reset; no duplicate replay from stale memory.
