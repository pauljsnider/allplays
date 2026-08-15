# Rescheduling Proposals

Status: Proposed

Depends on: [Facilities and eligibility rules](./04-facility-eligibility-rules.md), [schedule generation and publication](./05-schedule-generation-publication.md)

## Objective

Let authorized coaches propose, counter, accept, decline, or expire schedule changes while the platform validates teams, facilities, and organization rules automatically.

## Requirements

1. A coach with current authority for an affected team may open a proposal for an eligible published event.
2. Candidate times and spaces are filtered by live availability, compatibility, blackout rules, rest constraints, and organization policy.
3. A proposal names every affected team, event, candidate slot, ruleset version, proposer, recipient, reason, and expiration.
4. The recipient may accept, decline, or counter; each transition is server-authoritative, idempotent, and auditable.
5. Acceptance revalidates current authority, schedule revision, facility availability, and all hard rules before committing.
6. A short-lived hold may protect a proposed slot, but an expired or superseded hold never grants acceptance rights.
7. Successful acceptance creates a new official schedule revision, updates both teams, releases the old booking, and queues notifications as one recoverable workflow.
8. Conflicting edits or proposals produce a stale-state response and current alternatives rather than overwriting newer decisions.
9. Organization administrators can require approval, intervene, or override with a recorded reason.
10. Families can view the pending proposal only if organization policy allows it; they cannot act on coach decisions.
11. Users receive status notifications without duplicate messages after retries.
12. Offline clients may draft a proposal but must reconnect and revalidate before submission.

## Design

### State machine

Use explicit states: `draft`, `proposed`, `countered`, `accepted`, `declined`, `expired`, `superseded`, and `cancelled`. Transitions occur through callable server operations with expected-version checks. Countering creates a new proposal version while retaining the negotiation history.

### Acceptance transaction

The acceptance service validates stable coach assignments, reloads the authoritative event and current facility rules, acquires the new booking, creates a schedule revision, retires the previous booking, and records an outbox event. If the transaction response is uncertain, the caller re-reads proposal and revision state before retrying or reporting failure.

### Experience

Show compatible options first, with plain-language explanations for unavailable choices. A timeline displays proposals and counters. Mobile actions are concise and accessible; advanced search and administrative override remain available on web.

## Tasks

- [ ] Define proposal, version, transition, hold, and notification-outbox schemas.
- [ ] Implement proposal authorization and the complete state machine.
- [ ] Integrate compatible-slot search with facility and schedule services.
- [ ] Implement atomic acceptance and revision creation with ambiguous-response reconciliation.
- [ ] Build coach web and mobile proposal, counter, decision, and timeline interfaces.
- [ ] Build administrator policy, approval, and override controls.
- [ ] Add push, email, and in-app notification routing with deduplication.
- [ ] Add simultaneous acceptance, stale revision, expired authority, hold expiry, retry, and offline tests.
- [ ] Add audit history, proposal-cycle metrics, and operator recovery views.
