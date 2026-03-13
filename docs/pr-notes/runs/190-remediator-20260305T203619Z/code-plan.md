# Code Role Notes

Plan:
1. Inspect current implementations in `firebase-messaging-sw.js`, `js/push-notifications.js`, and `functions/index.js`.
2. Apply minimal deltas only where feedback is not fully addressed.
3. Validate with available project checks.
4. Stage and commit only remediation-related files.

Assumptions:
- Firebase web config is public metadata, but review requirement is to avoid inline literals in SW source.
- No automated unit test suite exists for frontend push behavior in this repo.
