# Architecture

## Current State
- `feeRecipients/{recipientId}` is parent-readable, so top-level billing metadata stored there is parent-visible by default.
- Checkout and refund flows already run server-side, but the storage boundary for sensitive billing metadata was too broad.

## Proposed State
- Keep `feeRecipients/{recipientId}` as the parent-readable summary document.
- Move Stripe identifiers, refund identifiers, receipt email, refund actor, and admin-only notes into `feeRecipients/{recipientId}/adminBilling/{billingId}`.
- Clear parent-readable sensitive fields on webhook and refund writes.
- Sanitize legacy parent models before render and normalization.

## Architecture Decisions
- Minimal subcollection split instead of schema rewrite.
- Server-authoritative write split in Cloud Functions.
- Defense in depth with both rules and frontend sanitization.
- Preserve existing payment/refund state transitions and stale-checkout guards.

## Controls And Blast Radius
- Rules: adminBilling is owner/admin only.
- Write-path changes are limited to team fee checkout/refund handlers and parent fee shaping.
- Parent-visible docs remain useful but no longer carry processor metadata.

## Rollback
- Revert functions, rules, UI sanitizer, and tests together as one unit.
- Prefer fixing any admin reader breakage by teaching it to read `adminBilling`, not by restoring private fields to parent-readable docs.
