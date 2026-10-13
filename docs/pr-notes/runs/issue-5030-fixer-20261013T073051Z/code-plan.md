# Code plan

1. Add focused single-document success and failure cases to `tests/unit/team-media-legacy-upload-forms.test.js`.
2. In `uploadSelectedFiles`, make the one-file reservation call explicit with count `1`; preserve the existing multi-file range branch.
3. Keep reservation and upload catches unchanged so existing UI reporting and `js/db.js` storage cleanup continue to apply.
4. Run only the focused Vitest file and inspect the final diff/status.
5. Commit the source, tests, and role artifacts together with an issue-referencing message.

## Risk controls

- No import or cache-critical module changes.
- No Firestore primitive/rules changes.
- No React or photo workflow behavior changes.
- No broad smoke/build execution.

## Role execution note

The requested `allplays-code-expert` skill was unavailable, and the accepted collector session failed before producing output with `published reply runtime missing for main`. This artifact records the main-run synthesis.
