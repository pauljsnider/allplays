# Architecture Role Summary

## Current State
`processPendingAdminInvites` records structured outcomes (`existing_user`, `fallback_code`, `failed`) but `edit-team.html` only reacts to fallback/failed aggregate counts.

## Proposed State
- Add a deterministic formatter (`buildAdminInviteFollowUp`) in `js/edit-team-admin-invites.js` to extract shareable invite artifacts from summary results.
- Consume formatter in new-team submit flow and present copyable data via `window.prompt` before redirect.
- Retain unresolved-count alert path for manual remediation.

## Risk and Blast Radius
- Blast radius is local to `edit-team.html` new-team submit path and invite-summary helper module.
- No Firestore schema/rules/auth contract changes.
- No behavior change to existing-team invite modal flow.
