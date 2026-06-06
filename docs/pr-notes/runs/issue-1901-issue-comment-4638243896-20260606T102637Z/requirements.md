# Requirements

## Acceptance Criteria
1. Parent-accessible fee data must not expose Stripe checkout IDs, refund IDs, payment intent IDs, charge IDs, receipt email, or admin refund notes in legacy dashboard or React parent-tools fee models.
2. Admin workflows must retain reconciliation data under `feeRecipients/{id}/adminBilling/{billingId}`.
3. Webhook and refund writes must clear or omit sensitive parent-readable billing fields by default.
4. Legacy fee documents must still render safely when older top-level fields exist.
5. Parents must still see safe payment state, amounts, refund amounts, dates, and public notes.
6. Firestore rules must deny parent access to `adminBilling` and allow authorized team owner/admin access.
7. Automated coverage must verify both parent redaction and admin-only storage paths.

## Out of Scope
- Parent fee UI redesign.
- Stripe business-logic changes beyond privacy hardening.
- Full historical migration of legacy fee records.
- Expanding `adminBilling` visibility beyond existing fee admins.

## Risks
- Admin tooling may still expect Stripe identifiers on the top-level recipient doc.
- Mixed historical data shapes may leak if sanitization misses an alias.
- Parents may need support references that now rely on amount/date/status instead of processor IDs.

## Open Questions
- Team owner/admin vs global-admin scope for `adminBilling` access.
- Whether any refund reason should ever be parent-visible beyond `publicNote`.
- Whether a separate migration/runbook is needed for historical cleanup.
