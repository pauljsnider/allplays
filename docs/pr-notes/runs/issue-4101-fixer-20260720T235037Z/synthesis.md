# Acceptance Criteria

1. Shared logger strings redact conventional email addresses as `[REDACTED_EMAIL]`.
2. Normalized errors and nested/free-form values share the protection.
3. Existing credential redaction and diagnostic context remain intact.

# Architecture Decisions

Implement only at the centralized logger boundary. Do not change auth state, storage, routing, native plugins, or signing enforcement.

# QA Plan

Prove the defect with a focused regression first, then run the complete logger test file and whitespace validation.

# Implementation Plan

Add one composed free-form redaction helper in `logger.ts` and one focused test in `logger.test.ts`.

# Risks And Rollback

Blast radius is shared diagnostic output only. A rollback is a two-file revert. Bootstrap-hint minimization was considered but rejected for this PR because it changes persisted state and an app routing consumer; it remains a separate issue slice.
