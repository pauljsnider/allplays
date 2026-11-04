# Unmounted schedule delivery interfaces

The backend coordinator and provider adapters are executable with isolated
clients, but are not registered in `functions/index.js`, the MCP server, or any
deployment. The existing schedule tool still reports delivery as `unverified`.
No credentials, access grants or production notification handlers change.

## Approval and event binding

`createScheduleDeliveryCoordinator` requires explicit implementations of
`authenticate`, `verifyApproval`, `verifyCommit`, `readEvent`, `authorize`, and
`resolveRecipients`. None has a permissive default. The first three are trust
boundaries, not JSON decoding hooks. They must verify broker-issued credentials
and independently authenticated evidence. A durable evidence authority now
implements issuance, one-use consumption and commit recording, but **the current
MCP transport and Firestore writer are not yet connected to it**. The tests use
synthetic broker/form and commit-observation verifiers; they do not validate a
deployed signing, transport or attestation scheme.

`bind(credential, { approvalHandle, commitHandle })` accepts opaque references
for those authorities. It never accepts a client completion record as proof.
The verified evidence must agree on:

| Evidence | Required binding |
| --- | --- |
| Principal | Exact UID, OAuth client ID and grant digest, plus session ID. The current connection must still have explicit review consent. |
| Action | Exact approval ID, proposal ID, team/event IDs, create/update mode, game/practice type and intent digest. |
| Content | Exact normalized event digest and previous event version; create requires a null previous version. |
| Confirmation | Separate `approve` and `notifyTeam` acknowledgments, both true; approval already consumed for this one action. |
| Timing | Issue → consumption → commit within a maximum two-minute approval window. Commit milliseconds must match the Firestore source version. |
| Commit | An authoritative successful commit, including its precise Firestore updateTime. A client-written `status: completed` is insufficient. |

The coordinator reads the authoritative event and checks its version and digest
before binding. One server-private binding is reserved per team/event/revision.
Different approval evidence cannot overwrite that binding. Lost binding commit
responses are reconciled by rereading the exact evidence hash.

`schedule-delivery-evidence.cjs` stores approval and commit evidence in the same
server-private journal namespace. Issuance requires a broker-verified form and a
validated command with matching actor/client/grant/session, intent, event and
preview digests. Model-selected booleans are not accepted as a form handle.
Consumption transactionally changes `approved` to `consumed` and returns a
single dispatch identifier only to the trusted commit worker. Concurrent or
repeated consumption fails. Lost persistence responses are reread by operation
identity; uncertainty never authorizes another execution attempt.

Commit recording requires that dispatch identifier and an independently verified
writer observation matching the exact command, principal and commit time. The
completed evidence survives restart and supplies the coordinator's verification
functions. A consumed attempt with no authoritative commit proof stays
unverified; a client-writable completion receipt cannot complete it. Retention,
cleanup and recovery across broker credential/session expiry remain integration
requirements. No evidence method is exposed as an MCP tool or HTTP route.

The future authority must prove that the approved intent actually generated the
committed event, not merely sign unrelated user-supplied hashes. It must also
retain consumed approval/commit evidence across process loss. Resolving a lost
user-credentialed Firestore commit response without trusting its writable
receipt remains an integration design prerequisite. This module does not give
the MCP service an Admin application-data client to solve that problem.

## Frozen provider requests

`deliver` resolves at most 100 exact recipient/channel targets, then freezes
the first plan, including an empty plan. Later workers reuse stored requests;
recipient discovery and serialization are not repeated for an existing plan.
Current manager and endpoint eligibility are rechecked before each dispatch.
An intervening event revision blocks a new plan or suppresses unsent targets.

The journal now accepts a bounded, versioned provider envelope. Its full JSON
parameters are included in the request hash and persisted before dispatch.
`schedule-delivery-providers.cjs` supplies:

- `firestore-inbox-v1`: deterministic per-effect document path, shared inbox
  payload normalization, fixed content and timestamp. A transaction writes once
  and preserves existing read state. Authoritative matching content resolves a
  lost response. Missing content cannot prove a rejected write. False persistence
  results require a matching reread before acceptance can be returned.
- `fcm-single-v1`: one exact token, notification/data fields, app route/link,
  web assets, Android channel and iOS metadata, with stable collapse identifiers.
  Only a valid provider message ID proves acceptance. SDK errors and malformed
  responses remain uncertain. No FCM status lookup or automatic push retry is
  invented; collapse identifiers are not an exactly-once guarantee.

Provider clients are mandatory injected dependencies. Tests use synthetic
clients and the local Firestore emulator. No real FCM call has been made.
The v1 serializer uses shared inbox, routing and delivery helpers; future changes
to those helpers must preserve the v1 contract or add a new adapter version.
Unsupported historical requests fail closed rather than being reserialized.
Device-specific rendering, inbox retention cleanup and invalid-token pruning
still require integration review before activation.

`schedule-delivery-audience.cjs` provides a bounded canonical-membership resolver
and a Firestore/Auth recipient loader. It reuses existing schedule preference
defaults and audience-role policy, excludes the acting user, preserves inbox
delivery for tokenless recipients, and suppresses disabled or opted-out users.
Incomplete membership/recipient/device results, more than 100 effects, more than
20 devices for a recipient, and conflicting token ownership fail closed instead
of sending a partial audience. Endpoint eligibility is reread before dispatch.
The loader derives device ownership from the user's collection path, not a
device's claimed uid. Production canonical member discovery, role resolution
and manager authorization must still be supplied from current authoritative
sources; a cached notification-recipient index is insufficient.

## Status reconciliation

`status(credential, { teamId, bindingId }, { reconcile })` authenticates the
current actor and requires the original UID/client/grant binding plus current
manager authorization. It reads only the frozen plan; status does not discover
recipients, create new delivery work or call the send adapter. Optional
reconciliation can confirm existing inbox content, while unknown pushes remain
uncertain. The result contains only an opaque binding ID, bounded state counts,
and `deviceDelivery: unverified`; no endpoints, request bodies, raw provider
errors, approval evidence or provider receipt IDs are returned.

`schedule-delivery-status.cjs` now supplies an unmounted HTTP handler. It accepts
only bounded JSON status requests, checks host/origin policy, requires a current
broker-authenticated actor and allowlisted App Check app, and consumes App Check
tokens for reconciliation. Missing replay evidence fails closed. Responses are
field-whitelisted and `no-store`. There are no send, bind, issue or consume
operations on this route. A transactional server-private fixed-window rate
counter allows at most 30 requests per actor/client/minute, including across
access-token rotation and instances. Counter uncertainty denies the request.

The HTTP handler is not registered or reachable. Actual broker and App Check
verifiers, parser/mount configuration and the legitimate remote-client path for
obtaining suitable App Check evidence are still needed. Do not disable App Check
or grant new service access to make that path work implicitly. Callback tests
do not establish the production network trust boundary.

## Activation prerequisites

1. Connect and review the durable authority's real broker-form, command and
   Firestore-writer verifiers and authenticated backend connection without
   broadening MCP application-data privileges.
2. Supply complete canonical member/role and manager authorization adapters to
   the implemented audience resolver; test revocation across the real path.
3. Route the selected approved schedule effect through exactly one consumer.
   The old notification path must not run alongside the new consumer. Its
   five-minute dedup claim or `null` result is not delivery evidence.
4. Review provider version compatibility, retention, cleanup and bounded status
   transport; test old/new writer compatibility and trigger retries.
5. Run isolated client end-to-end, native/provider integration and security
   review before any activation. Production deployment remains unauthorized.
