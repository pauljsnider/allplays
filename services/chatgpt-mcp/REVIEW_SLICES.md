# Proposed review and activation slices

This is a local/repository review plan, not a landing handoff. PR #5153 remains
draft with `external-claim`; its previously denied description update is not
retried. No dependent PRs, competing writers, branch rebases or deployment
changes have been created by this assessment.

## Assessment

Split before handoff. At `23e0bb67fa5eaa45b8dcd13d00cddb5b1880bc35`, the draft
already changed 59 files with 5,847 additions and 42 deletions relative to
`ed4d65e77d5417fd42239139c29b2684912be3a9`. The delivery-journal prototype adds
another security boundary. One review spanning OAuth consent, browser writes,
session confirmation, transactions, domain parity and provider delivery would
be difficult to validate as a unit. Those layers also have different activation
requirements.

Use one producer to assemble and validate dependent draft branches from a frozen
checkpoint. Keep #5153 as the integration draft until the stack is agreed. Do
not mark it ready, rebase it or open parallel remediation sessions simply to
produce smaller diffs. The current chronological commits are useful evidence,
but they are not clean cherry-pick boundaries: later commits revise shared
factories, discovery and transaction helpers.

## Proposed dependency order

| Slice | Concrete scope | Dependencies and activation boundary |
| --- | --- | --- |
| A: Preserve practice reminder settings | The seven-line `scheduleService.ts` fix and its four web/native regression cases. | Independent. Existing app behavior only; no MCP activation. |
| B: App review consumer | `McpActionReview`, `mcpActionReviewService`, app catalog, route, private-AI pending-action handling, component/service/auth-smoke tests. | Independent of new MCP producer. Publish consumer before enabling producer requests. |
| C: Explicit review consent | OAuth scope consent, grant persistence and identity compatibility tests. | No domain writes. Existing read grants remain read-only; reconnect requires explicit consent. |
| D: Review-request producer and discovery | `writeReview`, service catalog, user REST staging, server registrations and roster discovery with rules/privacy tests. | B + C. This is the first complete 46-action app-review workflow; it is separate from direct execution. |
| E: Direct transaction and confirmation core | Revision engine, domain-limited REST store, team proposal privacy, one-action approval and confirmation schemas; favorite command as the smallest real domain. | C + D helpers where required. Keep unmounted. Can be subdivided into core/store and authenticated-transport reviews. |
| F: Authenticated direct transport | Session router/authenticator and broker-bound HTTP tests, including disconnect, actor/grant binding, expiry and replay. | E. Keep unmounted; no public host configuration or persistent execution grant. |
| G: Configuration, roster and practice domains | Configuration clone/rename; single and batch roster edits; draft timelines; matching discovery, fixtures and rules tests. | E + F. Split by domain if necessary; add only that domain's registrations/dependencies in each branch. |
| H: Schedule and RSVP domains | Ordinary schedule create/update, separate notification acknowledgment, schedule app-review fallback, manager RSVP overrides and cutoff tests. | E + F; uses roster/schedule discovery from G/D. Unmounted. Notification delivery still unverified by MCP; RSVP aggregate/family gaps remain explicit. |
| I: Durable delivery journal | `functions/notification-attempt-journal.cjs`, isolated state-machine tests, real-rule privacy tests. | Independently reviewable server-only core; no `functions/index.js` import. It is not a provider adapter or deployed trigger. |
| J: Delivery and client integration | Verified event/version-to-intent binding; frozen audience resolver; inbox/push adapters; authenticated bounded status endpoint; MCP receipt lookup. | H + I and explicit security/integration approval. Must ship before direct schedule activation; not implemented by the journal alone. |

Each branch must contain only its intended factory registrations and dependencies.
Copying the final `directFavoriteMcp.js` or `directSessionAuth.js` into E/F would
import domains not yet present. Likewise, split the combined schedule/RSVP and
roster/rules tests by their dependencies. A stack-building script must check
that each intermediate tree imports successfully and passes its own focused
tests; do not declare a stack reviewable from the final integration tests alone.

## Delivery integration decisions still required

1. Bind the source to a verified Firestore event revision and the approved
   schedule save. The new journal accepts only an internal verified request;
   it must never be exposed as a generic client-selected sender.
2. Resolve and freeze the exact recipient/channel/endpoint plan in server-only
   storage. Revalidate actor, source and each endpoint before dispatch. A retry
   must not add newly joined members or rotated device endpoints to that plan.
3. Replace the ordinary notification path for the selected source only after
   the new consumer is ready. Do not run both paths or wrap the current
   five-minute pre-send dedup claim and interpret its `null` return as delivery.
4. Pin the provider serialization version and persist the complete resolved
   provider parameters, including routing/delivery options, before dispatch. The
   journal currently freezes the bounded schedule request envelope; concrete
   provider adapters are not implemented. Give inbox writes a stable document
   key and an authoritative reconciliation adapter. Push acceptance is not device delivery. If the provider cannot
   reconcile a timed-out request, retain `uncertain` and do not resend it.
5. Keep exact parameters and provider evidence server-private. Current rules
   deny all client access to `notificationSendLog`; do not weaken them or give
   the MCP service an Admin application-data client. A future authenticated
   backend may return only authorized, bounded status and opaque identifiers.
6. Prove old/new writer compatibility and trigger retry behavior with isolated
   end-to-end tests before activation. Live provider testing, deployed client
   confirmation and security review remain outstanding.

## Ownership and evidence

One writer should assemble the stack, retain draft/external ownership, and
publish exact source-head test evidence for each slice. Freeze each head before
any landing handoff. Do not refresh the denied metadata operation as part of
this work. This plan does not create additional PRs or authorize production
activation, new credentials, access grants, provider calls or data writes.
