# Architecture

## Decision
- Keep remediation inside `escapeCsvValue` in `js/team-fees-admin.js`.
- Apply formula neutralization before quote/comma/newline escaping so the final serialized output is both safe and valid CSV.

## Blast Radius
- Scope is limited to team fee payment summary CSV serialization.
- No Firestore schema, UI flow, or download plumbing changes are required.

## Rollback
- Revert the single helper change and related unit test if any downstream export compatibility issue appears.
