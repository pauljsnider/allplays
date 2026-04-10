Objective: prevent photo-only saves on `player.html` from erasing private profile fields after a denied or failed private-profile read.

Current state:
- `openEditModal()` catches private profile read failures and renders empty emergency contact and medical fields.
- The submit handler always sends `emergencyContact` and `medicalInfo`, so a photo-only save can overwrite existing sensitive data with blanks.

Proposed state:
- If the private profile read fails, preserve user intent by excluding untouched private fields from the update payload.
- Continue allowing explicit edits to private fields in the same modal session when the user changes those fields.

Risk surface and blast radius:
- Affected data is sensitive player information in `teams/{teamId}/players/{playerId}/private/profile`.
- Failure mode is silent destructive overwrite of emergency and medical details.
- Blast radius is limited to the player edit modal, but impact is high because it touches safety-critical data.

Assumptions:
- Photo-only edits remain valid when the private profile fetch fails.
- Existing `updatePlayerProfile()` semantics are correct when omitted keys are absent from `data`.
- A targeted unit regression test is sufficient for this issue because the repo already uses Vitest source-extraction tests for HTML pages.

Recommendation:
- Add a payload-shaping helper in `player.html` and dirty-field tracking for the private fields.
- Verify the helper omits untouched private fields after read failure and still includes them in normal edit flows.
