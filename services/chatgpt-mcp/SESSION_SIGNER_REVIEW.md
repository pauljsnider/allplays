# Isolated authenticated session-to-signer composition

The direct prototype can now compose an actual authenticated MCP SDK session,
its exact confirmation form, a private signed command channel, live session
introspection, and the credentialed schedule executor. This is opt-in library
code only. Neither `server.js` nor `functions/index.js` imports or mounts it.
No production key, grant, IAM binding, credential or application record changed.

## Trust and execution path

`createDirectSessionRouter` accepts one optional `createScheduleBroker` factory.
It rejects simultaneous local schedule evidence and signed broker factories.
The selected factory supplies schedule prepare/confirm/status implementations;
other bounded prototype domains retain their existing confirmation paths.
Authenticated actors' deadlines are capped by their original session deadline.
Closing a session closes the broker and clears its status-only submission ledger.

`createSignedScheduleBroker` prepares and reviews through the existing schedule
engine. It never invokes that engine's local confirm/write operation. An opaque
WeakMap handle records the preview, account/client/grant/session binding, and
short form deadline only after the actual one-action approval path accepted both
save and notify acknowledgments. Serialized, missing or foreign handles fail.
No handle, key, envelope or user ID token is returned in MCP results.

After the form, the broker rereads the proposal and current targets, recomputes
revisions/preview through the shared engine, compares the approved normalized
command, consumes the one-action approval, and reauthenticates. It then signs the
exact command/preview with the host-supplied Ed25519 key. No refresh credential
is accepted by the backend. The backend independently verifies signature, user,
current session, team authorization and approved semantics before execution.
All business data requests remain user-credentialed and rules-enforced.

The broker records a submission before awaiting transport. Any later confirm,
prepare or status for that proposal performs only a signed `schedule.status`
request. A transport timeout is not proof the business write failed. No automatic
execution resend occurs, even if status reports `not_started`. Status uses a fresh
bounded authentication window but cannot execute or authorize notification sends.
A client-writable completed receipt is reported as unverified backend status.
The ledger is bounded to 100 submissions per session and never evicts a pending
entry to make room for another execution.

## Private transport and session authority

The router's `introspectSession` callback is host-only; it is not an MCP tool or
public route. It matches the exact account, OAuth client, grant and live session,
reauthenticates using the original connection, rechecks deadline/disconnect after
the await, and returns only binding, connected/review flags and bounded expiry.
It never returns a Firebase ID or refresh token.

`createScheduleSessionHttpHandler` wraps that callback in private workload-authenticated
ingress at `/internal/v1/schedule-session`. The shared ingress preserves method,
exact path/host, no browser origin, content type, workload audience/principal,
current allowlist, rate limit, byte limit and body deadline checks. It rechecks
workload expiry after awaited work. Session requests are limited to 2 KiB and
cannot request more than a 120-second authorization window.

`createScheduleSessionIntrospector` is the backend's corresponding live-session
adapter. `createScheduleBrokerCommandClient` sends signed commands to the exact
private command path. Both use a fixed HTTPS URL/audience, disable redirects,
obtain workload tokens from a host-supplied provider, cap response data at 4 KiB,
and bound the entire request including token acquisition. Default deadline is
5 seconds, configurable up to 10 seconds. There are no retries or credential logs.
Only minimal validated status/binding data is accepted from responses.

## Validation

This checkpoint passes **311 backend tests**, **417 MCP unit/protocol tests**,
and **96 tests across four emulator-backed suites**. New tests include 27 private
session/client cases, three session introspection/configuration regressions,
16 signer/capability tests, and ten composed emulator cases. The emulator suite
loads the repository's compacted Firestore rules through rules-unit-testing;
the emulator's startup default-rule warning does not describe the rules used by
the tests.

The composed cases use the real OAuth broker and grant authenticator, actual MCP
SDK HTTP form elicitation, ephemeral signing keys, both private HTTP adapters,
actual live-session introspection, the signed channel, schedule engine, user REST
writes and private durable evidence. They cover game/practice create/update,
status-only replay, a lost private response, decline/cancel/missing notification
approval, wrong live session and a target changed during the form. Tests assert
zero broker-local business commits and exactly one backend commit on success.

The additional signer tests reject serialized/foreign capability reuse, account,
client, grant, scope, expiry and disconnect changes, modified proposals, and
concurrent confirms. They bound retained attempts and ensure user-writable
receipts never become backend commit proof. Private HTTP tests cover mismatched
identities, extra credential fields, oversized messages, delayed token/body
responses and expiry after awaited introspection. Earlier executor/channel guard
regressions remain included.

## Remaining activation prerequisites

1. Production identity verification and hosting: wire reviewed SDK verifiers,
   service-to-service workload tokens, exact IAM/host/audience allowlists, rate
   limits, secret custody and signing-key rotation through a separately approved
   deployment. Fixtures do not establish real Google/Firebase identity behavior.
2. Multi-instance session routing: backend introspection must reach the owning
   live broker instance or a reviewed authenticated session registry. Unknown,
   restarted, disconnected or differently bound sessions currently fail closed;
   there is no fallback to trusting caller-provided session claims.
3. Restart/status recovery: the approved preview/command ledger is intentionally
   session memory only. A replacement session cannot reconstruct private status
   authority from client receipts. Durable recovery and actor/grant revocation
   policy require review; do not interpret missing status as permission to resave.
4. Explicit backend/broker packaging: shared imports currently cross the
   `services/chatgpt-mcp` and `functions` source trees. Existing deployment packages
   do not automatically include the whole composition. No deploy configuration
   was changed as part of this isolated checkpoint.
5. Native ChatGPT integration and independent security review: actual client form
   support, connection loss, latency and concurrency behavior still need an
   authorized disposable integration environment. The present tests are SDK
   clients on loopback, not a live ChatGPT connection.
6. Notification rollout remains separate: real audience readiness, platform
   trigger capture, legacy-consumer ownership migration, provider sends,
   reconciliation, alerts and recovery workers remain activation gates. The
   composed executor test deliberately uses synthetic empty audiences and never
   sends notifications. Results continue to say notification delivery unverified.
7. Full create/update parity remains unfinished. This signer/backend composition
   supports ordinary game/practice create/update only; specialized schedules,
   consequential access/finance/communications flows and other direct prototypes
   must not be activated by treating this checkpoint as blanket authorization.
