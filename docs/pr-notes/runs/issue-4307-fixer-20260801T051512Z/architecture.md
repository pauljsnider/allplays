# Architecture

## Current flow

`PlayerDetail` calls `createCoParentInvite`. The callable verifies exact `parentPlayerKeys` linkage, checks active normalized duplicates before rate limits, and atomically writes a new access code plus durable sender/recipient reservations. Firestore `onCreate` then queues a deterministic `mail/invite_<codeId>` record. Duplicate requests do not emit another create event; throttled transactions commit no writes.

## Test boundary

Use one in-memory Firestore state with the production `createCoParentInviteHandler`, `createInviteEmailOnCreateHandler`, email eligibility helper, message builder, and deterministic mail-ID helper. A trigger pump processes only newly committed `accessCodes` creates. This pins the callable-to-trigger seam without loading the unrelated monolithic function index.

## Safety review

- Authorization remains fail-closed and is covered by adjacent core tests.
- Duplicate detection precedes quota reservation.
- Throttled transactions leave no partial durable state.
- Mail delivery remains asynchronous and retryable; deterministic mail IDs make trigger replay idempotent.
- Synthetic fixtures avoid private data. Runtime code, schema, rules, and UI are unchanged.

Recurrence risk is low after coverage because the new test directly measures the only previously unpinned seam.
