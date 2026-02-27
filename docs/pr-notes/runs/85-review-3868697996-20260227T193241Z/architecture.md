# Architecture Role Notes

## Blast Radius
- Limited to admin-invite code path in `edit-team.html` and `js/edit-team-admin-invites.js`.
- No Firestore schema or rules changes.

## Design Decision
- Add code validation guard directly in queued invite processor before email dispatch.
- Mark missing-code cases as `fallback_code` with an explicit reason to keep flow non-fatal.
- Clear pending queue in page state after processing to eliminate duplicate in-session retries.

## Control Equivalence
- Access control unchanged (`inviteAdmin` still creates access codes in Firestore).
- Auditability improved through explicit result entries for missing-code fallback.
