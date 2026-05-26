# Code Plan

The dedicated code-plan role timed out, so implementation uses the completed requirements, architecture, and QA findings.

## Plan

1. Locate the legacy item move handler in `js/team-media.js`.
2. Replace filtered reorder source with the full folder item sequence.
3. Add/update a regression assertion in `tests/unit/team-media-page.test.js` proving filtered subset reorder is not used for persistence.
4. Run the targeted Vitest files.
5. Commit scoped changes only.
