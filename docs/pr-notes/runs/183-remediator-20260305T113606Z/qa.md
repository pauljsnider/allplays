# QA role (fallback inline)

## Risk focus
- Premature bracket completion across rounds with BYEs.
- Public unauthenticated fetch permission-denied when query lacks published filter.
- Timestamp type drift between stored bracket doc and derived published view.

## Validation plan
- Run focused Vitest files:
  - `tests/unit/bracket-management.test.js`
  - `tests/unit/bracket-publish-db-policy.test.js`
- Ensure BYE regression scenario now leaves downstream unresolved game pending until both participants known.
- Ensure db policy test still confirms `publishedAt` stays Timestamp in publish path.
