# QA analysis

- Validate the approval path no longer attempts an unauthorized write to `/users/{requesterUserId}` for non-global-admin approvers.
- Run focused tests for the parent membership helpers/wiring if present.
- Residual risk: if some UI depends immediately on requester-side denormalized fields, confirm that behavior still derives from team-owned membership docs or existing reads.
