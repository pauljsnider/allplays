# Isolated signed-channel schedule executor

`src/backendScheduleExecutor.js` now composes the signed channel with the actual
schedule command engine, user-credentialed REST store, private evidence authority
and producer reservation. It is an unmounted backend factory, not an MCP tool or
raw-JSON route. Neither production entry point imports it. Its shared-module
location does not authorize giving the MCP service private application-data
credentials; backend evidence/producer factories must remain backend-owned.

## Enforced execution boundary

The executor requires both non-serializable channel guards and rejects an async
or non-void final guard. It snapshots the verified actor, exact command, approved
preview, short-lived ID token and signed time window. Actor IDs, command keys,
UUID-v4 proposal IDs and deterministic create-event IDs are checked before data
access. No refresh credential is accepted or persisted.

Execution requires an already prepared proposal belonging to that actor. The
signed command and preview must exactly match the stored normalized command and
preview. The existing engine then rechecks current target/team/schedule revisions
and recomputes the preview. The executor does not create a new proposal, accept a
remote write plan, or bypass the normal schedule validations.

The existing approval interface receives a single-use adapter for the verified
signed save-and-notify approval. The channel's current exact-team manager check
is projected into the domain authorization interface; no role or grant is
written. Every application read and write still uses the user's original ID
token and Firestore rules. Transport rejects unexpected project targets and
credential substitution, and disables redirects.

Private producer arming, durable dispatch marking and post-acknowledgment
checks use the existing evidence bridge. After those awaits, the executor
revalidates channel authorization. The returned synchronous REST guard executes
both the local approval guard and the signed-channel deadline/key guard directly
before fetch. Tests observe this final guard immediately before each business
commit request. Expiry, signing-key removal and disconnect during producer
acknowledgment all result in zero business commits with the dispatched fence
retained.

The channel receives `commitVerified: true` only after the existing writer's
actual commit response, user-credentialed event reread, durable private evidence
and proof publication succeed. The callback independently checks the evidence's
actor, proposal, team, event, mode, event type and approved-intent/preview hashes.
A completed user receipt alone never grants backend commit authority. A lost
response or failed proof write can leave a real business write completed while
channel status remains unverified; retries must inspect status and must not
repeat the write.

## Validation and limits

Validation passes **284 backend tests**, **398 existing MCP unit/protocol tests**,
and **86 tests across four emulator-backed suites**. The latter includes the
new executor's 17 emulator cases and four construction/guard-contract tests.
New cases cover game/practice create/update, parallel replay and restart,
substituted command/preview/proposal, client receipt rejection, changed target
revision, rules-denied credentials, delayed-ack guards, lost commit responses,
failed private proof and a real loopback HTTP request through the actual channel
and executor. Private evidence is unreadable through user rules; durable state
does not contain the invocation's ID token.

The new tests use actual Firestore rules/transactions and ephemeral signing keys.
Workload/user identity verification and broker-session introspection are fixture
interfaces in this composition. The separate SDK tests exercise Google signature
verification with local certificates; no live identity provider was contacted.
The producer uses the actual recovery pipeline, with synthetic audience readiness
and no trigger capture or provider sends in this executor suite. Prior suites
cover the separate trigger/recovery/delivery composition.

## Remaining activation prerequisites

1. Bind the actual MCP form response to the signer and implement authenticated,
   bounded broker-session introspection. This suite signs isolated approved
   fixtures; it is not native ChatGPT confirmation-to-backend integration.
2. Wire the reviewed SDK user/workload verifiers, current manager authorization,
   pinned signing keys, workload allowlist, rate limits and request deadlines in
   an approved backend host. No new keys, grants or IAM settings were created.
3. Package the shared ESM executor/domain modules for that backend explicitly.
   The current Functions deployment directory does not automatically include
   `services/chatgpt-mcp/src`. No deployment/bundle configuration changed.
4. Wire real audience readiness and platform trigger capture, migrate all legacy
   schedule consumers to shared ownership, and deploy a reviewed recovery worker
   with retention, alerts and provider reconciliation. Do not enable a second
   sender or interpret the synthetic empty audience here as production readiness.
5. Complete authoritative reconciliation for ambiguous dispatches and for a
   private proof/business write whose channel completion state was not saved.
   Define replacement-session status and background grant/revocation policy.
6. Finish independent security review and authorized native-client/provider
   integration. Full create/update parity outside this bounded ordinary schedule
   executor remains unfinished. Production activation is not authorized by these
   tests or by the existing draft PR.
