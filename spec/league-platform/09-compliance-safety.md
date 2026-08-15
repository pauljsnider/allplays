# Compliance and Safety

Status: Proposed

Depends on: [League foundation](./01-league-foundation.md), [sports, seasons, and divisions](./02-sports-seasons-divisions.md)

## Objective

Track role-specific safety requirements, evidence, review, expiration, and access enforcement while minimizing exposure of sensitive personal information.

## Requirements

1. Administrators can define requirements by organization, season, sport, division, staff role, jurisdiction, and effective date.
2. Requirement types include training, certification, acknowledgement, identity verification, background screening, and organization-defined checks.
3. A staff assignment has a derived compliance state of not started, pending, needs review, approved, expiring, expired, rejected, or waived.
4. Approval or waiver requires an authorized reviewer, reason, evidence provenance, effective period, and immutable audit history.
5. Privileged staff actions can require current approved status; enforcement occurs server-side at the action boundary.
6. Status summaries may be visible to schedulers and team administrators, but underlying reports and sensitive evidence are limited to designated compliance roles.
7. External verification uses provider-neutral adapters, durable request IDs, idempotent callbacks, and private provider payload storage.
8. Expiration reminders are configurable, deduplicated, and sent only to permitted recipients.
9. Revocation or expiration identifies affected assignments and access without deleting historical proof.
10. Retention and deletion policies distinguish audit facts from source documents and satisfy legal-hold overrides when configured.
11. A provider outage or incomplete read yields pending or unknown, never an approved or clear result.
12. Families and unrelated coaches cannot infer sensitive screening details from status endpoints, errors, or notification text.

## Design

### Policy and evidence model

Version requirement policies and bind each staff assignment to the applicable version. Store minimal status projections separately from encrypted or access-restricted evidence metadata. External documents should remain with the provider when possible; stored references must not function as public bearer access.

### Evaluation and enforcement

A deterministic evaluator combines policy requirements, verified evidence, waivers, and time. Server operations that require cleared staff re-evaluate authoritative data rather than trusting cached UI status. Changes emit an outbox event for access refresh and notifications.

### Review experience

Provide compliance staff with queues for pending review, expiring items, provider exceptions, and affected assignments. Coaches see required next actions and status without sensitive reviewer notes. Every decision displays its policy version and audit trail to authorized users.

## Tasks

- [ ] Define policy, requirement, staff assignment, evidence, decision, waiver, and reminder schemas.
- [ ] Implement deterministic status evaluation and server-side enforcement hooks.
- [ ] Implement provider-neutral request and callback adapters with idempotency.
- [ ] Build compliance configuration, review queue, decision, and exception screens.
- [ ] Build staff web/mobile status, instructions, submission, and renewal experiences.
- [ ] Add restricted projections, evidence access rules, retention, and deletion workflows.
- [ ] Add expiration and access-refresh jobs with deduplicated reminders.
- [ ] Add incomplete-provider, stale-status, revocation, waiver, privacy, and retention tests.
- [ ] Add audit events, operational metrics, and provider reconciliation tools.
