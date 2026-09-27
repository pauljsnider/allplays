# Acceptance Criteria

Default-on full-team cross-post, explicit opt-out, selected-member email-only safety, one atomic reciprocally linked chat record, combined success reporting, and no duplicate notification inbox path.

# Architecture Decisions

- Coerce stale targeted cross-post flags to false instead of rejecting, preserving the selected-member workflow while preventing disclosure.
- Use the existing app adapter boundary for a direct callable, avoiding a cache-critical `js/db.js` source change.
- Use additive response fields `chatMessageId` and `chatPostCreated`.

# QA Plan

Test UI state/payload/success copy, service normalization, adapter transport, server atomic linkage, exactly-one creation, opt-out, targeted safety, authorization, and notification suppression.

# Implementation Plan

Tests first, then minimal UI/service/adapter/backend changes, focused validation, and one commit referencing #4650.

# Risks And Rollback

Primary risk is full-team disclosure of targeted content; the server final-audience gate controls it. Rollback is additive and requires reverting the client flag and server chat write; existing callers remain email-only when the flag is absent.
