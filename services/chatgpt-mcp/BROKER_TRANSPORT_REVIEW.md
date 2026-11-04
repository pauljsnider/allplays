# Isolated broker/backend transport and rollout contract

This checkpoint is an executable protocol model, not an activated backend or a
finished remote create/update workflow. No production entry point imports these
modules. Tests create ephemeral signing keys in memory and use synthetic user
and workload identities; no keys, grants, accounts or secrets are provisioned.

## Command transport

`functions/schedule-broker-channel.cjs` defines an Ed25519-signed envelope with
an exact audience, purpose, actor/client/grant/session, bounded issue/expiry,
command, original approved preview, separate save/notify acknowledgments, and
a hash of the accompanying short-lived user ID token. The signature covers
exact serialized bytes and key ID. Backend public keys are explicitly pinned;
unknown or removed keys fail closed. This is an internal signing primitive,
not a public tool or a substitute for the existing one-action form authority.

`functions/schedule-broker-http.cjs` adds a private POST contract with exact
path/host/content type, no browser origins, bounded body, workload-identity
allowlist and required rate limiter. Workload token verification is a required
host interface; merely decoding a token is not an implementation. The command
signature is verified independently of workload ingress authentication.

The backend independently checks current Firebase user identity, disabled and
verified-email state, token expiry, broker grant/session liveness and current
manager authorization, before and after durable reservation. The real Firebase
SDK, platform IAM verifier and broker introspection implementations remain
unwired. Their permission model and credential custody require review.

The user token is carried only in the private request and executor invocation;
it is never written to attempt records, status, logs or raw error output. Durable
state contains hashes, timestamps and outcome state. No refresh token crosses
this boundary. Production requires TLS with fixed endpoint/audience, no redirect
following, platform identity, request deadlines and log redaction at the host.
The loopback test uses plaintext exclusively with synthetic tokens.

## Execution and recovery

A server-private reservation is keyed by actor UID, team and proposal, while
its binding includes the full session identity, command and approval. Parallel
requests, process restarts, transport retries, refreshed tokens and new nonces
cannot repeat the same mutation. A different command/session using that proposal
fails closed. The original session is currently required for status; recovery
after session replacement needs a separately reviewed read-only protocol.

An uncertain reservation response prevents execution. An executor timeout, lost
write response or missing completion persistence remains unverified. Recovery
reads only durable status; it never retries a business write or treats a
client-writable receipt as proof. A client disconnect does not make an already
started mutation safely repeatable. A lost completion response can recover an
already persisted committed status without executing again.

**The executor in these channel tests is synthetic.** The production executor
must be backend-owned, use the acting user's token for Firestore REST, rebuild
and validate the exact signed preview/intent through the reviewed semantic
verifier, and persist verified commit evidence from the actual response and
credentialed reread. Never accept a remote `commitVerified` result or a client
write plan as evidence. The actual broker/form-to-signer adapter and the channel-
to-existing-credentialed-executor composition remain integration gates.

## Canonical audience

`functions/schedule-canonical-membership.cjs` supplies concrete Firestore/Auth
reader adapters for the current role sources: owner ID (or unambiguous legacy
owner email), team admin emails and `users.parentTeamIds`. It excludes favorites,
`coachOf`, profile email and cached recipient roles. Email-based access requires
verified current Auth email; a manager must have a current enabled, verified
account. IDs and grant emails are never trimmed. Owner-email fallback requires
an absent or exactly empty owner ID and string aliases that agree; null, numeric,
padded or tabbed owner IDs never become an absent ID. Admin authorization uses
only the exact Auth email or its lowercase form as a stored list entry, matching
a stricter subset of the rules. In particular, the prototype intentionally does
not accept the rules' limited single-space admin-email compatibility variants.
Candidate email lookup may case-fold addresses, but every role is rechecked
against the raw grant. This stricter policy still needs compatibility review.

Queries fail closed above 100 candidate users rather than returning a partial
list. Recipient resolution uses current Auth status, preferences and user-owned
device records; authorization rereads manager roles, recipient membership and
the specific endpoint before each dispatch. Discovery is bounded, not a global
transactional membership snapshot. A member added during resolution need not
be in that already frozen attempt; revoked members/devices are suppressed.
No production audience reads or sends were performed.

## Single-consumer rollout

The active owners remain `notifyGameCreated` and `notifyGameUpdated` in
`functions/index.js`; import-batch delivery also has its own existing trigger.
Do not enable the new coordinator as a second sender.

`functions/schedule-consumer-ownership.cjs` models one immutable consumer owner
per exact team/event/commit-version schedule effect. Equivalent timestamp
spellings use the same key without collapsing nanoseconds. Shadow mode leaves
legacy in charge. Journal mode requires a verified deployment gate identifying
compatible legacy/journal code and producer compatibility, plus server-verified
eligibility for each exact effect. `schedule-effect-eligibility.cjs` resolves a
private evidence reference, verifies the durable committed approval, and rereads
the exact event version/content. Only a bounded ordinary game/practice shape
may select journal. Imported, recurring, linked, live, special-engine or unknown
shapes remain legacy; ordinary legacy writes without a pre-armed private producer fence remain
legacy. A matching pending producer must wait for proof or durable closure. Lookup/verification errors assign no owner, rather than guessing.
Client event fields and completion receipts cannot select an owner. Journal
ownership records retain the eligibility evidence ID; a journal record without
that binding fails closed. Cutover or rollback affects only new effects; existing
ownership never fails over automatically. This selects a consumer, not a second
replacement for that consumer's durable per-recipient delivery deduplication.

The production effect-to-evidence index adapters, deployment-gate verifier and
integration into both consumers are **not implemented or deployed**. If an effect is reserved
for legacy before its private proof exists, later proof must not reassign it.
The producer/trigger proof-ordering race must be resolved in the activation
review; this model deliberately preserves existing ownership. Required rollout order:

1. Deploy a backward-compatible ownership reader to every existing consumer,
   retaining legacy ownership and delivery behavior. Verify exact deployed code.
2. Run the new path as a non-sending shadow; establish writer/import/native
   compatibility, source-version identity and retry behavior.
3. With action-time deployment approval, enable journal ownership only for the
   reviewed supported effects. Preserve the legacy owner for existing attempts.
4. On rollback, retain handlers/reconciliation for already journal-owned effects;
   do not route them to legacy or replay uncertain sends.

The gate reader must use authoritative deployment provenance, not user-writable
configuration or an unverified boolean. Partial deployments or unreadable gate
state must block activation. No live gate, security rule or consumer changed.

## Validation at `770afef7`

The combined backend suite passes 209 tests, including 40 channel/HTTP cases,
20 canonical-membership, 13 consumer-ownership and 33 per-effect eligibility cases. It tests signature
and token substitution, current identity/scope checks, parallel replay, process
restart, lost persistence, false persistence results, disconnects, payload bounds,
audience revocation, incomplete discovery and rollout/rollback races. Existing
notification evidence, journal, coordinator and sender regressions are included.
Actual loopback HTTP is exercised; actual production TLS/IAM/Auth is not.

A focused Firestore emulator run passes 43 tests across broker/evidence,
schedule/RSVP and private notification-journal suites. The new canonical-audience
case executes real Firestore queries and membership revocation checks against
isolated data; Auth remains synthetic.

Pre-activation review of `b0659b7b` reproduced 14 failing regressions: eleven
malformed-identity grants and three ineligible-effect consumer selections. All
now pass. Fifteen paired emulator cases compare the canonical manager decision
against actual rules, including padded IDs, tabs, null IDs/aliases, valid owner
email fallback and the intentionally stricter spaced-admin case. No Firestore
rules or production entry point changed.

## Follow-up ordering and compatibility model

The [proof/trigger ordering review](PROOF_TRIGGER_ORDERING_REVIEW.md) supersedes
the earlier missing-proof routing assumption. It models pre-write private fences,
retryable pending triggers and atomic proof-versus-legacy closure, and evaluates
manager compatibility against actual emulator rules. The production hooks,
durable payload/recovery worker and audience-readiness gate remain open.
