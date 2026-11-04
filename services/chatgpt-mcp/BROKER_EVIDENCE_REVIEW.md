# Broker-to-commit boundary: local review checkpoint

Feature expansion is paused for review. This checkpoint adds no create/update
actions and activates no endpoint or notification consumer.

## Fail-closed hardening

Commit `030db46d7b942e12c9677f3108477ca0f1ab3498` is independently reviewable:

- `createDirectFavoriteMcpSession` refuses construction without an explicit
  approval authority. The raw `elicitInput` fallback is removed.
- `createRevisionCommands.confirm` refuses accepted form content without a
  callable one-use consumption hook and always consumes it before commit.
- `createOneActionApproval` requires a live actor/client/grant binding and a
  bounded approval lifetime, then rechecks binding and expiry before consumption.

Sixteen regression cases cover omitted authorities, raw form-only composition,
missing consume hooks, incomplete actors and unbounded lifetimes. They fail on
the prior source. A clean archive of this commit passes 337 MCP tests without
the later adapter code. A custom authority remains trusted application code;
the presence of a callback alone is not cryptographic proof of correct behavior.

## Actual isolated composition

The local adapter now connects the existing OAuth broker, identity resolver,
authenticated HTTP MCP session, actual form elicitation, domain transaction
engine and user-credentialed Firestore REST writer to the durable authority.
The authenticator explicitly returns verified review consent; the session
adapter supplies the transport-owned session ID. Callback-bound broker client
IDs contain a dot, so bounded client-ID validation is separate from document-ID
validation. Client identity still must match the authenticated grant exactly.

`directScheduleEvidence.js` captures forms as opaque in-process object handles.
JSON tool arguments and user-writable receipts cannot manufacture these handles.
Before a schedule commit it verifies the approved preview, current actor,
exact project, transaction read versions, event write, completion metadata and
companion deletion. The durable authority consumes one action before execution.

Independent review of `ee9d7192` found that matching the preview digest alone
did not bind the supplied write's semantics. A trusted-composition harness could
substitute an unapproved opponent and obtain evidence for that different event.
Create and update regression tests reproduced acceptance before this fix; this
was not demonstrated reachable through the current domain engine.

The bridge now privately snapshots the actual approved preview and independently
reconstructs the allowed write in `scheduleEvidenceSemantics.js`. It normalizes
the requested changes, recomputes the actor-bound intent digest, verifies the
target/mode/type and current before/derived after summaries, and compares the
entire canonical wire mutation. Create defaults, actor audit fields, shifted
end/arrival times, and the exact update mask are enforced. Audit timestamps are
bounded to the approval attempt. Added, removed, or substituted fields fail
before evidence issuance; neither a supplied digest nor a completion receipt
can bless a different write. The verifier deliberately remains independent of
the domain writer: adding a write field requires explicit verifier review.

This fix passes 54 bridge tests (including create/update game/practice success
and field-tampering regressions), 391 MCP tests overall, and 18 focused emulator
tests. The new real-broker integration regression injects a malicious write plan
at the trusted-composition boundary and verifies zero business commits and no
delivery evidence. These checks do not establish the production channel below.

After an acknowledged Firestore commit, the adapter verifies write-result count
and event updateTime, then rereads that exact event using the current user's
credentials. Its content digest uses canonical Firestore wire fields, preserving
unrelated timestamps, references, nulls and empty containers. Only this observed
write can complete the server-private evidence record. No private proof or
dispatch identifier is placed in a personal receipt or MCP response.

A lost commit response can leave the schedule saved while evidence remains
consumed/unverified. The user-writable completion receipt may support the
existing user-facing outcome lookup, but **cannot recover backend send
authority**. No write or notification is automatically repeated to resolve
that uncertainty. Forged response versions and changed event reads likewise
cannot produce completed evidence.

Six emulator cases exercise successful create/update binding, separate consent,
model-injected proof fields, wrong-user commit credentials, lost responses,
forged commit versions, preserved unrelated wire values and isolated partial
delivery/reconciliation. OAuth/form/transaction implementations are real; the
Firebase refresh endpoint and notification providers are synthetic. No real
Firebase accounts, credentials, persistent grants or deliveries are created.

## Production approach requiring review

The local test composition puts components in one trusted process. **Do not
deploy that composition by adding application-data Admin credentials to the MCP
service.** Its existing service identity remains limited to the OAuth store.
The authority factory and opaque object handles are not a split-process API.

A viable production direction is a dedicated backend command boundary that:

1. Accepts broker-originated one-action form evidence over an authenticated,
   replay-protected channel. It verifies the original UID/client/grant/session,
   preview/intent, separate notification acknowledgment and short expiry.
   A public `confirmed: true` parameter is never sufficient.
2. Revalidates the bounded domain command and executes Firestore REST with the
   acting user's short-lived ID token, so application reads/writes remain
   rules-enforced. Backend privilege is confined to private evidence/delivery
   storage; it is not used to bypass the user's mutation authorization.
3. Captures the actual commit response and matching user-credentialed reread
   within that trusted backend, persists proof before returning completion,
   and preserves an unknown outcome when that proof cannot be established.
4. Resolves recipients from current canonical sources and exposes only bounded
   authenticated status. The remote client's legitimate App Check path still
   needs review; no exemption or service access grant has been added.

That channel, service placement, token handling, replay/retention behavior and
operational recovery require independent security review before implementation
or access changes. The current adapter is executable local evidence for the
contract, not an implemented production transport or signing system.

## Single-consumer activation gate

Neither `server.js` nor `functions/index.js` imports the new composition. Tests
run the Firestore emulator, not deployed notification triggers. They do not
prove safe coexistence with the legacy schedule notification handler.

Before activation, the selected schedule effect must have exactly one consumer,
with reviewed producer-before-consumer rollout and old/new writer compatibility.
Do not run the legacy trigger and new dispatcher side by side. Live client,
provider/native, deployment and independent security validation remain open.
