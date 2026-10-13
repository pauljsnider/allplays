# QA analysis

## Focused coverage

1. Invoke the legacy helper with two supported documents and assigned orders,
   including `0`; assert each `uploadTeamMediaFile` call receives the matching
   order and progress callback and that no new reservation occurs.
2. Reject one ordered upload and allow the next to succeed; assert the failed
   row keeps the original message and red styling, the successful row completes,
   and the aggregate summary remains `1 file uploaded, 1 failed.`
3. For the ordinary document form, assert the uploader options omit `order`,
   preserving fallback compatibility.
4. Run the existing unsupported-document validation regression unchanged.
5. Pass an explicit order through the DB metadata-save cleanup regression and
   assert the uploaded object is deleted without a fallback transaction.

## Validation

Run:

`npx vitest run tests/unit/team-media-legacy-upload-forms.test.js tests/unit/team-media-db-ordering.test.js --reporter=verbose`

The first suite covers caller plumbing and UI failure reporting. The second
proves persistence and cleanup at the actual DB boundary.
