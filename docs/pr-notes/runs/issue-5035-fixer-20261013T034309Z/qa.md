# QA analysis

## Regression strategy

1. Submit a mixed valid/unsupported document selection and assert the valid
   file receives its indexed reserved order while unsupported-file validation,
   partial-failure reporting, selected-folder state, and input clearing remain.
2. Submit two valid documents with reserved values `0` and `17`; reject one
   uploader call and assert both invocation options, ordering of reservation
   before upload, the original error message, red failure state, successful
   sibling, library refresh, and input clearing.
3. Retain the dependency regression that directly invokes the shared helper
   without assigned values and verifies `order` is omitted.
4. Rely on the focused DB ordering regression for persistence and Storage
   cleanup after an explicitly ordered metadata-write failure.

## Focused validation

Run:

`npx vitest run tests/unit/team-media-legacy-upload-forms.test.js tests/unit/team-media-db-ordering.test.js --reporter=verbose`

These are the nearest unit suites for the changed form wiring and the
downstream persistence/cleanup contract.
