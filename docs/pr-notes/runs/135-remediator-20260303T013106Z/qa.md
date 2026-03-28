# QA Role Notes

## Test focus
- `fetchCalendarIcs` handles OPTIONS and GET only, with origin filtering.
- Requests from disallowed origins return HTTP 403 JSON error.
- URLs targeting localhost/private/link-local/metadata endpoints are rejected.
- Timeout path returns controlled error message instead of uncaught rejection.
- Client function fetch gracefully falls back when runtime function URL config is absent.

## Validation approach
- Syntax check Cloud Functions file with Node.
- Manual spot-check for changed branches and error handling paths.

## Gaps
- No automated function integration tests in repo for end-to-end CORS/origin matrix.
