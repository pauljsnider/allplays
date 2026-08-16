# League Foundation

Status: Proposed

Depends on: Existing identity, team, player, and event models

## Objective

Introduce an organization boundary above teams so administrators, coaches, and families can share authoritative rosters, schedules, settings, and communication without breaking existing team-centered flows.

## Requirements

1. An organization has a stable ID, public profile, timezone, lifecycle state, and private operational settings.
2. Organizations contain seasons, teams, facilities, participants, staff assignments, and feature entitlements without copying canonical identity records.
3. A user may belong to multiple organizations and hold multiple scoped roles, including organization administrator, scheduler, registrar, compliance manager, coach, family member, and viewer.
4. Role grants and revocations must be server-authoritative, auditable, time-bounded when configured, and keyed to stable user IDs rather than mutable email addresses.
5. Multi-record grants must update reciprocal membership and organization records atomically; incomplete evidence must fail closed.
6. Existing teams must continue to work before they are linked to an organization, during migration, and after linkage.
7. Administrators receive a desktop-oriented organization portal; coaches receive web and mobile entry points; families receive one mobile dashboard across organizations, teams, and players.
8. Organization context must be explicit in URLs, navigation, server calls, analytics, and audit records to prevent cross-organization data leakage.
9. Public fields and privileged operational fields must use separate read models. Secrets and sensitive workflow state must never be stored in public or member-readable projections.
10. Organization and role reads must expose completeness evidence; partial results cannot establish that a user has no access.
11. Core operational screens must support keyboard navigation, assistive technology, reduced motion, and meaningful loading and error states.
12. Operational workflows must not be interrupted by promotional modals or unrelated upsell prompts.

## Design

### Data model

Add canonical organization records plus server-maintained membership and resource indexes. Teams retain their existing IDs and gain an optional immutable `organizationId`. Organization-scoped resources carry both their own owner ID and the organization ID; authorization verifies the complete relationship rather than trusting a client-provided parent path.

Separate broadly readable profile data from private settings, membership provenance, invitation state, and audit records. Use version fields for organization settings and role policies so later migrations can be resumed safely.

### Authorization

Centralize role evaluation in shared web and server helpers, then enforce the same boundary in Firestore and Storage rules. The canonical user ID is authoritative once present. Invitations may use contact information for delivery, but redemption must bind a stable principal in a single server transaction.

### Experience

Create an organization switcher, role-aware navigation, and route guards in the React app. Reuse the same state and service layer for packaged mobile builds. The legacy site may link into the new portal but must not gain a second implementation of organization logic.

### Migration and rollout

Ship read-compatible organization fields first. Provide an idempotent migration that links eligible existing teams without changing their canonical ownership. Roll out organization reads, then server mutations, then navigation. Retain a documented rollback path that leaves teams usable independently.

## Tasks

- [ ] Define organization, membership, role assignment, invitation, audit, and projection schemas.
- [ ] Add server-side validators and atomic grant, revoke, and invitation-redemption operations.
- [ ] Add Firestore and Storage rules with cross-organization denial tests.
- [ ] Add organization context, switching, and role-aware navigation to the React app.
- [ ] Add organization setup and settings screens with accessible state handling.
- [ ] Add migration tooling for existing teams, including dry-run and restart support.
- [ ] Add complete/partial access-load behavior and preserve the last complete state on failure.
- [ ] Add audit events, structured logs, and metrics for membership and settings mutations.
- [ ] Add unit, integration, rules-engine, and web/mobile smoke coverage.
- [ ] Document staged rollout, rollback, and operator recovery procedures.
