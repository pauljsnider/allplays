# Registration and Financial Operations

Status: Proposed

Depends on: [League foundation](./01-league-foundation.md), [sports, seasons, and divisions](./02-sports-seasons-divisions.md), [licensing and entitlements](./03-league-licensing-entitlements.md)

## Objective

Provide organization-managed registration, charges, receipts, refunds, and reconciliation that feed authoritative participant and team records while isolating sensitive payment state.

## Requirements

1. Administrators can configure registration periods, participant questions, required acknowledgements, division choices, capacity, waitlists, discounts, and charge schedules.
2. Families can register multiple participants from one account while preserving a distinct participant identity and response history for each entry.
3. Eligibility is evaluated from the published division rules and returns explainable results or an administrator review state.
4. Registration submissions are versioned and retain the exact form, policy acknowledgements, and rules used at submission.
5. Charges support registration, installment, adjustment, credit, tournament, and other organization-configured categories.
6. Payment status, receipts, refunds, disputes, and reconciliation are authoritative server records; the UI never infers success from navigation alone.
7. External payment actions use durable reservation, idempotency, exact request replay, validated destinations, and authoritative post-error re-read.
8. Payer identity, provider payloads, session identifiers, tokens, and bearer URLs remain server-private and principal-bound.
9. Capacity and waitlist transitions are serialized across concurrent registrations and cannot over-enroll a division silently.
10. Administrative adjustments and refunds require permission, reason, actor, audit history, and a preview of participant impact.
11. Confirmed registrations can flow into team formation without re-entering participant or guardian data.
12. Sensitive participant responses use field-level access policy, retention, export, and deletion rules.
13. Families receive accessible receipts and clear pending, failed, refunded, waitlisted, and needs-review states.

## Design

### Registration model

Separate published form definitions from immutable submissions. A registration references participant, family account, season, division preference, ruleset version, capacity reservation, and financial account. Store sensitive responses in a restricted record and expose a minimized operational projection.

### Financial ledger

Use an append-only organization ledger for charges, payments, credits, refunds, and disputes. Derived balances are reproducible and never replaced by mutable totals alone. Provider attempts live in private records; webhooks and callable operations update the ledger idempotently.

### Capacity and lifecycle

A server transaction reserves capacity before starting a principal-bound payment flow. Confirmed provider state completes registration and promotes eligible waitlisted entries through a deterministic process. Ambiguous outcomes preserve the reservation until reconciliation establishes whether the external effect committed.

## Tasks

- [ ] Define form, submission, participant response, registration, capacity, waitlist, ledger, and private attempt schemas.
- [ ] Build form publication, eligibility review, submission, and amendment operations.
- [ ] Implement serialized capacity reservation and deterministic waitlist promotion.
- [ ] Implement idempotent payment, receipt, adjustment, refund, dispute, and reconciliation operations.
- [ ] Build family registration and status experiences for web and mobile.
- [ ] Build administrator configuration, review, ledger, refund, and export screens.
- [ ] Connect confirmed registrations to team formation and roster projections.
- [ ] Add privacy, retention, authorization, provider timeout, concurrency, and ambiguous-write tests.
- [ ] Add audit events, financial reconciliation metrics, and operator recovery procedures.
