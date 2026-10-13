# QA analysis

## Focused coverage

1. Invoke the legacy helper with two supported documents and assigned orders,
   including `0`; assert each uploader call receives the matching order and a
   progress callback, with no new reservation call.
2. Reject one ordered upload and allow the next to succeed; assert the original
   failure message and red styling, successful sibling, aggregate counts, and
   library refresh remain intact.
3. For the ordinary document form, assert uploader options omit `order` and no
   reservation occurs, preserving single-file fallback compatibility.
4. Keep the existing unsupported-document validation regression.
5. Exercise DB metadata-save cleanup with an explicit order and assert the
   uploaded object is deleted without a fallback transaction.

## Validation

Run:

`npx vitest run tests/unit/team-media-legacy-upload-forms.test.js tests/unit/team-media-db-ordering.test.js --reporter=verbose`

The form suite covers caller plumbing and failure reporting. The DB suite proves
persistence and cleanup at the Firebase boundary.
