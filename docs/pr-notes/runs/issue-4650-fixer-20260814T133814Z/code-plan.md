# Patch Plan

1. Add failing component, service/adapter, and callable regressions.
2. Add default-on full-team checkbox state and combined success copy.
3. Normalize cross-posting to full-team only in the client service and server callable.
4. Use a typed direct callable in `legacyChatService.ts` so `js/db.js` and its cache-bust cohort remain untouched.
5. Create reciprocal email/chat documents in the initial batch.
6. Suppress direct team-email inbox records only when chat is created.
7. Run the smallest focused tests and required Functions loader suites.

# Code Changes Applied

No changes were applied by the analysis role. Only the main lane edits.

# Validation Run

No validation was claimed by the analysis role.

# Residual Risks

- Existing exact-payload tests need updates.
- The server-authored chat record must match the established render/trigger schema.
- Later mail-job chunk failure can mark email partial-failed after the linked initial batch commits.

# Commit Message Draft

`Publish full-team emails to team chat (#4650)`
