# QA analysis

Add a focused Vitest service test with the compatibility adapter mocked. The test should use a verified parent identity, provide a cursor, return a normalized application with `hasMore`, `nextCursor`, `retryCursor`, and a retryable partial error, then assert:

- exact delegation to `listParentRegistrationApplicationsPage` with UID and verified email;
- the cursor is forwarded unchanged;
- the full result object is returned unchanged.

Also cover an unverified email to prevent accidental guardian-email use while retaining the UID query, and reject a missing authenticated UID before delegation.

The nearest legacy regression suite already covers query deduplication, enrichment, cursor calculation, and partial failures, so the new app test should focus strictly on boundary preservation.
