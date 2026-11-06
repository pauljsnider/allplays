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
| J: Delivery and client integration | Event/version binding coordinator; pinned inbox/push adapters; bounded status functions; future trusted evidence authority, audience resolver and status endpoint. | H + I and explicit security/integration approval. Coordinator/adapter interfaces now have isolated tests. Durable evidence, status routing and audience interfaces now exist unmounted; real broker/writer/client adapters and MCP receipt lookup remain unfinished. |

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
4. Review the now-implemented versioned provider envelopes and injected
   inbox/FCM adapters against the actual clients. Complete parameters, routing,
   channel options and stable identifiers are persisted before dispatch.
   Deterministic inbox content supports reconciliation. Push acceptance is not
   device delivery; unknown push outcomes remain `uncertain` without resending.
   Provider/native compatibility and historical serializer support need review.
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

## Materialized local slices

`scripts/prepare-review-slices.mjs` creates patch artifacts from exact Git
commits without creating branches or publishing PRs. It verifies application
against a clean archive of the base and runs the dependency-free Node suites
after each journal layer:

- A: the independent practice reminder fix and its app regression tests.
- I1: the journal state machine, unit tests and emulator privacy suite at
  `30c7453082f175dbc0d69f833d6b63c9d24a394e`.
- I2: the versioned request extension, binding coordinator, provider adapters,
  shared fixture, and expanded unit/emulator tests at
  `cae0a9637909f764ace760ab6ac6ffd0af43e9d9`. Depends on I1.
- I3: durable actor-bound evidence, authenticated status/rate limits, canonical
  audience interfaces and integration tests at
  `bed4ababb5f545d3b3e891002b2dd7baeb3dc99d`. Depends on I2.
- J1: fail-closed exported composition paths and 16 regressions at
  `030db46d7b942e12c9677f3108477ca0f1ab3498`. Applies to the full bed4abab
  integration tree, including the still-unsplit B–H domains; it does not apply
  to the small journal-only stack.
- J2: optional local actual-broker/form/credentialed-write evidence adapter,
  broker client-ID compatibility and adversarial integration tests. Depends on J1.

Each artifact has a SHA-256 digest and exact source commits in `manifest.json`.
App tests and emulator suites still need to run on eventual branch trees;
the script's Node/MCP unit checks are explicitly narrower than emulator, app
and production integration validation. It verifies that neither
`functions/index.js` nor `firestore.rules` changes in these slices. The earlier
B–H slices remain a dependency-aware assembly plan, not materialized branches.
The coordinator/adapter layer is still larger than the preferred review target;
its trust-boundary tests should accompany implementation in the same review.

Run from the repository root with a fresh output directory:

```sh
node services/chatgpt-mcp/scripts/prepare-review-slices.mjs \
  ed4d65e77d5417fd42239139c29b2684912be3a9 \
  30c7453082f175dbc0d69f833d6b63c9d24a394e \
  cae0a9637909f764ace760ab6ac6ffd0af43e9d9 \
  bed4ababb5f545d3b3e891002b2dd7baeb3dc99d \
  030db46d7b942e12c9677f3108477ca0f1ab3498 HEAD /tmp/allplays-review-slices
```
