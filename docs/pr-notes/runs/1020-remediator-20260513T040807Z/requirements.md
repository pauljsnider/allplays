# Requirements notes

## Acceptance criteria
1. Admin registration setup exposes bounded payment settings for offline payment and future online checkout intent.
2. Registration form payloads persist normalized boolean payment settings.
3. Existing forms without payment settings normalize to disabled.
4. Public registration submissions snapshot bounded payment settings.
5. Admin and public copy clearly avoid implying live checkout exists today.
6. Firestore public registration payload validation accepts only the bounded payment settings shape.
7. Existing unit coverage verifies admin normalization, public normalization, snapshotting, UI hooks, and rules coverage.

## Review finding
Amazon Q reported no blocking issues. No product requirement change is needed for this remediator pass.

## Non-goals
Stripe checkout sessions, payment webhooks, payment status mutation, installments, discounts, roster automation, and document upload remain out of scope.
