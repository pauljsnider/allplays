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
and independently authenticated evidence. **The current MCP transport does not
yet produce this durable evidence.** The tests use synthetic authorities; they
do not validate a deployed signing or attestation scheme.

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

## Status reconciliation

`status(credential, { teamId, bindingId }, { reconcile })` authenticates the
current actor and requires the original UID/client/grant binding plus current
manager authorization. It reads only the frozen plan; status does not discover
recipients, create new delivery work or call the send adapter. Optional
reconciliation can confirm existing inbox content, while unknown pushes remain
uncertain. The result contains only an opaque binding ID, bounded state counts,
and `deviceDelivery: unverified`; no endpoints, request bodies, raw provider
errors, approval evidence or provider receipt IDs are returned.

There is no HTTP/callable status endpoint yet. Mounting one requires authenticated
request validation and the applicable App Check policy, rate limits, replay
review and transport integration. Internal callback tests do not establish those
network protections.

## Activation prerequisites

1. Implement and review the trusted approval/commit authority and authenticated
   backend connection without broadening MCP application-data privileges.
2. Implement complete current audience resolution, including membership,
   preferences and endpoint ownership, and test revocation across the real path.
3. Route the selected approved schedule effect through exactly one consumer.
   The old notification path must not run alongside the new consumer. Its
   five-minute dedup claim or `null` result is not delivery evidence.
4. Review provider version compatibility, retention, cleanup and bounded status
   transport; test old/new writer compatibility and trigger retries.
5. Run isolated client end-to-end, native/provider integration and security
   review before any activation. Production deployment remains unauthorized.
