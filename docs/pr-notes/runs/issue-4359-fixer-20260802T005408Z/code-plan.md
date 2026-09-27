# Acceptance Criteria

1. Remove client-side destination reuse from the staff share/copy path.
2. Resolve every destination through `initiateStaffTeamFeeCheckout`.
3. Reject any returned value that is not a canonical HTTPS `checkout.stripe.com` URL before external APIs.
4. Preserve valid server regeneration and reuse behavior for share and copy.
5. Surface a recoverable inline error on resolution or validation failure.

# Architecture Decisions

- Keep the validator local to `TeamFees.tsx` for this narrow staff-only slice.
- Require exact hostname `checkout.stripe.com`, HTTPS, no credentials, and no nonstandard port.
- Keep stored metadata for labels only. Never use it as a destination fallback.
- Preserve the existing server authorization and checkout service contracts.

# QA Plan

- First add focused component regressions for poisoned stored metadata, invalid server responses, regeneration, and reuse.
- Confirm the new tests fail against the current short-circuit and truthiness-only behavior.
- Implement the minimal component change.
- Run the focused TeamFees suite, then the app build for TypeScript and import validation.

# Implementation Plan

1. Update canonical URL fixtures and add share/copy boundary regressions.
2. Replace the stored-URL short circuit with an unconditional server checkout call.
3. Add fail-closed canonical destination validation before returning from resolution.
4. Refresh the model after a successful external action so regenerated state is visible.
5. Review the final diff and commit all code, tests, and run artifacts together.

# Risks And Rollback

- Exact-host validation excludes future Stripe Payment Link hosts. Revisit only if Team Fees intentionally adopts Payment Links.
- Client validation cannot prove a canonical-looking URL belongs to the expected session. Server-side binding remains out of scope and is tracked by the parent work.
- Rollback is a single commit revert. No data migration or schema rollback is required.

# Production Safety Review

- Authorization: unchanged and fail-closed through the existing staff service and callable checks.
- Stale state: revalidated through the server operation immediately before every share or copy.
- Selectors: existing team, batch, and recipient identifiers are sent unchanged to the authoritative operation.
- Partial failure: invalid resolution, validation, share, or copy shows a recipient-level recoverable error and never falls back to stored metadata.
- Privacy and logging: no checkout destination or token is added to logs or telemetry.
- Confirmation, retention, deletion, atomicity, collection limits, persistence durability, and interrupted-worker recovery: not applicable because this slice performs no new write, delete, batch, or background operation.
- Interrupted browser/native share behavior: existing cancellation handling remains unchanged after destination validation.

# Conflict Resolution

The QA role suggested optional service-boundary validation. The architecture and code roles favored page-boundary validation because this slice is specifically about preventing staff share/copy APIs from receiving unsafe destinations. The selected design validates at the immediate external-action boundary, minimizes scope, and directly covers mocked invalid service responses. Parent and server validation remain separate slices.

# Root Cause

`resolveCheckoutUrl` trusted an open recipient's normalized stored checkout destination and bypassed the server operation. When the server was used, the returned URL had no canonical provider validation before sharing or copying.

# Prevention / Learning

Treat persisted payment destinations as untrusted hints. Re-resolve them through the authoritative server operation and validate provider, scheme, credentials, and port at every external navigation, share, or clipboard boundary.

# Regression Tests

Focused TeamFees component tests will prove poisoned stored metadata cannot bypass server resolution, invalid server destinations cannot reach either public action, and valid regeneration/reuse still works.

# Recurrence Risk

Medium before the parent server-authoritative work lands because a canonical-looking Stripe URL is not yet bound to an actual reusable session. Low for arbitrary-host distribution through this staff UI after this patch.

# Commit Message Draft

`Harden staff team fee checkout sharing (#4359)`
