# MCP write review workflows

## Implemented boundary

The MCP service retains its original three read tools, adds managed roster
discovery, and adds the 46 canonical write
names in `src/writeCatalog.json`, plus `get_action_status`. Each write tool saves
a **review request**, not a business mutation. It returns an authenticated app
link. In that app, the user selects **Prepare for review**, sees the normalized
proposal, and selects **Confirm change**. The existing private AI registry runs
both preparation and execution. This does not call the AI model to re-interpret
the request or require an AI token to prepare structured arguments.

**This is not direct in-chat execution.** A ChatGPT "yes" cannot execute a write.
This first implementation intentionally requires app confirmation because the
current mutation catalog is browser/Capacitor code, not a shared server API.
Extracting those domains into server-authoritative commands is still required
for full native MCP parity. Do not advertise this as completed direct-write MCP.

The connected All Plays tools available when this work began were get_profile,
list_schedule, and get_game_summary, matching source at ed4d65e7. This work has
not been deployed or tested against production data.

## Catalog and behavior

| Area | Canonical actions |
| --- | --- |
| Teams and staff | create_team, update_team_settings, invite_team_admin |
| Roster | apply_roster_import, invite_roster_parent, resend_roster_parent_invite, update_player_profile |
| Games and practices | create_schedule_event, update_schedule_event, cancel_schedule_event, apply_schedule_import, update_game_score, complete_game_wrapup |
| Attendance and assignments | update_rsvp, update_rsvps_for_children, claim_assignment, release_assignment, manage_schedule_assignment, send_rsvp_reminder, save_practice_attendance |
| Practice and tracking | save_practice_packet, mark_practice_packet_complete, save_practice_timeline, save_team_tracking_item, set_player_tracking_status, save_stat_configuration, set_team_drill_favorite, prepare_resource_packet |
| Rides | create_ride_offer, request_ride_spot, cancel_ride_request, set_ride_offer_status |
| Communications | send_team_message, send_team_email |
| Family and access | create_household_invite, create_family_share_link, revoke_family_share_link, update_family_share_calendars, submit_access_request |
| Fees and registrations | create_team_fee, review_registration |
| Incentives | save_player_incentive_rule, toggle_player_incentive_rule, retire_player_incentive_rule, set_player_incentive_cap, mark_player_incentive_paid |

The app's existing feature availability, manager/parent authorization, verified
email, entitlement, App Check, recipient resolution, and domain validation still
apply. Resource packets remain gated by their existing feature flag. Files and
images are not uploaded through this bridge; use structured roster operations or
schedule rows, or the app's existing attachment workflow. This catalog covers
private AI writes, not every control on every legacy page. The existing read
catalog is still limited: get_team_roster adds manager-only player discovery,
but most other complex IDs must come from known app context.

For a roster conversation, call get_profile to select the exact managed team,
then get_team_roster. Follow nextCursor until hasMore is false before deciding
whether a name is new or uniquely identifies a player. Both active and inactive
players are included; never merge duplicate names automatically. Pages are not
a frozen snapshot. The app still reloads and revalidates current roster data
before confirming an import. Contacts and private profile fields are omitted.

Catalog JSON is duplicated in the isolated MCP package and app package because
production builds prohibit importing the service source into the app. Tests
require those copies to match and require every canonical private AI write to
be present. Preserve the production artifact guard.

## Request contract

Example call to create_schedule_event (synthetic identifiers):

```json
{
  "requestId": "00112233-4455-4677-8899-aabbccddeeff",
  "arguments": {
    "teamId": "synthetic-team",
    "eventType": "practice",
    "input": {
      "title": "Passing practice",
      "startDate": "2026-11-10T18:00:00-06:00",
      "location": "Field 2"
    }
  }
}
```

Choose one UUID v4 per intended request and reuse it after every timeout or retry.
A reused key with different arguments fails. Manager tools require exact teamId;
MCP does not resolve an ambiguous team name. Other arguments follow the current
app tool description. Never insert hidden confirmation fields or credentials.

A saved response means only "requested". Call get_action_status with requestId
after the user reviews it. Report completion only for completed. Partial is not
complete. Reopen the review link for the remaining prepared rows and explicitly
confirm their new preview; successful rows are not replayed. Failed may include
a domain error after partial effects; verify actual app state before making a
replacement request. Preparing/executing after an
interruption is uncertain and blocked, not an invitation to retry with a new key.

## Authorization, privacy, and retry design

- Only explicitly consented allplays.review broker grants may save requests.
  Scope denial happens before application-data access, with an MCP insufficient-scope
  challenge. Call arguments and Firebase direct bearers cannot grant this capability.
- All request reads and commits use the caller's Firebase ID token; no Admin SDK
  or Cloud Run application-data access is introduced.
- Requests use existing privateAiPendingActions rules. User envelopes carry
  toolName=mcp_review_request and status=mcp_request; the normal app confirmation
  executor does not recognize that tool. MCP exposes only a create-only envelope
  writer, never arbitrary Firestore updates or an execution endpoint.
- Manager request arguments are atomically written to the team's protected
  pending payload; the user's envelope contains empty args and scope metadata.
  Current manager rules are rechecked when loading the payload. Another user's
  review URL grants no access. Team payloads become unreadable after 30 minutes.
- A stable argument digest binds idempotency keys. A lost commit response is
  reconciled by reading the exact user envelope, not issuing a replacement key.
- Preparation and confirmation have transactionally claimed states. Ambiguous
  persistence never triggers automatic restaging or replay. Existing app action
  claims supply the final single-execution boundary.
- The displayed normalized argument fingerprint is compared again inside the
  existing pending-action claim transaction. A changed proposal cannot execute
  under an earlier displayed review.
- Results sent to MCP contain status, expiry, action name, and app URL, not
  roster payloads, message bodies, invitation capabilities, or provider results.
- The review link contains only an opaque request UUID. It performs no mutation
  on page load and preserves its destination across the app sign-in gate.

## Connection and rollout

The endpoint, credentials, IAM policies, and security rules remain unchanged.
The new allplays.review OAuth scope requires an explicit, initially unchecked
consent checkbox during connection. Existing read grants and direct Firebase
bearers remain read-only; they cannot save review requests. Scope is bound into
the encrypted authorization-code and access/refresh grant metadata and survives
rotation and instance restarts. An old read refresh token cannot upgrade itself.

After a reviewed release: publish the app review route first, then deploy the
MCP revision. Reconnect the ChatGPT app requesting allplays.read allplays.review,
approve saving review requests, rediscover its tools, and use
an isolated test account to verify review and confirmation end to end. Keep the
old read tools available throughout. Existing connectors do not automatically
prove that newly advertised tools have been refreshed.

Do not enable a production rollout until review, full required CI, app/browser
and native validation, and a test-account connection smoke are complete. This
session does not authorize deployment, merge, or real team/game writes.

## Remaining work for direct MCP mutations

An isolated, unregistered direct-command prototype supports eleven bounded
operations: team-drill favorite changes, stat-configuration cloning and renaming,
single-player roster creation and updates, draft practice timeline creation and
updates, atomic basic-roster batches, ordinary schedule creation and updates,
and single-player manager RSVP overrides. It is exercised only with synthetic
clients and data. The production server does not import it or advertise its
tools. It does not grant persistent access or widen an OAuth scope. The 46 normal
write-request tools still require app confirmation.

`directRevisionCommand.js` shares proposal identity, actor checks, five-minute
expiry, exact-preview/revision comparison, atomic receipts, and uncertain-outcome
reconciliation. Domain definitions in `directFavorite.js` and
`directStatConfiguration.js`, `directRoster.js`, `directRosterBatch.js` and
`directPracticeTimeline.js`, `directSchedule.js` and `directRsvp.js` specify the allowed arguments, targets, preview and
write. `directCommandStore.js` shares user-credentialed REST transactions, while
separate adapters allow only the relevant domain paths. The factory in
`directFavoriteMcp.js` composes the domains and their common confirmation flow;
its historical filename remains for compatibility.

The complete prototype composition advertises thirty-four tools, including
three schedule app-review/discovery tools:

| Tools | Bounded behavior |
| --- | --- |
| prepare_team_drill_favorite, confirm_team_drill_favorite, get_team_drill_favorite_action | Review, apply, and check one favorite add/remove. |
| prepare_clone_stat_configuration | Prepare copying one existing same-team configuration with a new name. The new document ID is deterministically derived from the proposal UUID. |
| prepare_rename_stat_configuration | Prepare changing only a configuration's name. |
| confirm_stat_configuration, get_stat_configuration_action | Explicitly approve either configuration operation and check its durable receipt. |
| list_managed_teams, list_team_stat_configurations | Discover current managed-team IDs/names and paginated configuration IDs/names/base types. |
| prepare_create_roster_player, prepare_update_roster_player | Prepare one basic player create/update with only name, number and position. |
| confirm_roster_player, get_roster_player_action | Approve one roster change and read its opaque completion receipt. |
| prepare_roster_batch, confirm_roster_batch, get_roster_batch_action | Prepare, explicitly approve and check one atomic batch of 1–20 basic player creates/updates. |
| list_team_schedule_events, prepare_schedule_event_review, get_schedule_event_review | Discover ordinary event IDs, stage a normalized create/update request with an advisory preview, and check its app outcome. No direct schedule execution. |
| prepare_create_schedule_event, prepare_update_schedule_event, confirm_schedule_event, get_schedule_event_action | Prepare and save an ordinary event with separate explicit approval of potential team notifications. The receipt confirms the save, not delivery. |
| prepare_staff_rsvp_override, confirm_staff_rsvp_override, get_staff_rsvp_override_action | Save the current manager’s response for one exact active player/event. No notes, base/family cleanup, messages or cached-total refresh. |
| get_team_roster | Discover active/inactive roster IDs and public display fields, using the existing manager-only paginated reader. |
| prepare_create_practice_timeline, prepare_update_practice_timeline | Prepare a draft timeline or a title/location change and appended blocks, linked to an existing non-recurring practice. |
| confirm_practice_timeline, get_practice_timeline_action | Explicitly approve a timeline change and check its opaque completion receipt. |
| list_team_practices, list_practice_timelines, list_practice_drill_options | Discover exact practice/timeline IDs and paginated community, published or team drill options. |

Clone preparation displays the exact copied schema, including stat visibility,
formulas and scoring settings. Unknown schema extensions or oversized previews
fail closed to the app editor; fields are never silently discarded. Cloning
preserves schema semantics, creates a fresh creation timestamp and does not
assign the result to any game. Rename uses a Firestore update mask for `name`
and `updatedAt`, preserving all other fields, including unknown extensions and
private stat definitions. Both operations recheck source/target/team revisions
and manager permissions before execution. A lost successful create response is
resolved from the atomic receipt, never by generating another document ID.

Discovery requires current manager access even though configuration metadata is
publicly readable under existing rules. It projects only summaries, handles
duplicate names through exact IDs and pagination, and propagates read failures.
It is not a frozen snapshot: preparation and confirmation re-read the target.

Roster creation supports name-only adds; number and position are optional.
Update requires an exact player ID and changes only explicitly supplied fields;
empty number/position clears that field. It preserves inactive status, legacy
restricted fields and private profiles. Contacts, invitations, custom fields,
photos and activate/deactivate are rejected rather than inferred. New player IDs
are derived from the proposal UUID. Preparation and confirmation query the
complete active/inactive roster, bounded to 200 players, with projected fields
and revision checks. Larger rosters fail to the app instead of checking a
partial page. Matching names, including inactive players and normalized
whitespace/case matches, require app review. A roster change after preparation
invalidates the preview. The query runs inside the committing transaction;
the emulator race test verifies that two separately approved same-name creates
do not both succeed. A transaction conflict never triggers automatic re-execution.

Roster batches reuse those same field and permission boundaries. Each create
gets an ID derived from the proposal UUID and operation index; each update
requires an exact existing player ID. Preparation checks all resulting names,
including duplicates within the batch and inactive players. Final-name swaps
are allowed only when the resulting names are unambiguous. Existing duplicate
names do not block number/position edits to exact IDs. A batch has at most 20
operations and leaves at most 200 roster players. One approval displays every
row, then a single transaction writes all rows, deletes the team proposal and
writes one opaque receipt containing IDs and counts. There are no partial
successes or automatic remaining-row retries. The full 20-operation boundary is
tested against real rules, as are concurrent batches and rejected commits.

Ordinary schedule discovery projects only public schedule fields and exact IDs.
The prototype accepts bounded game/practice create/update review requests with
explicit UTC offsets, rejecting invalid calendar dates, ambiguous local times,
recurrence, imported/linked/active/special-engine event updates and unrelated
fields. Game fields include opponent and home/away; practice fields include
title. Arrival time applies only to games. Omitted end/arrival times in an
update preview shift with the requested start time, matching the app handler.
The bridge stores only requested fields; its preview is advisory, and the app
rebuilds the authoritative preview from current data before explicit approval.

The separate direct schedule domain uses the same normalized inputs but freezes
an exact revision/preview for one atomic save. Creation is limited to teams with
fewer than 200 stored schedule records so a complete transactional duplicate
check is possible. Matching type, start time and opponent/title require app
review, including competing creation proposals. Updates use field masks to
preserve notes, scores, reminder history and extensions. Tournament, linked,
imported, recurring, active and special-engine events remain excluded.

Ordinary creation and date/location/title updates can trigger team notifications
independently of pre-event reminder settings. Direct schedule confirmation
therefore requires **two separate default-false boolean acknowledgments**:
`approve` for the displayed save and `notifyTeam` for its stated communication
effects. A conversational yes, an argument supplied by the model, a missing
checkbox or a truthy string cannot substitute. `directConfirmation.js` defines
the known acknowledgment fields; the session approval object binds their exact
preview to one actor/client/grant and one commit attempt. The schedule confirm
tool advertises external effects through `openWorldHint`.

No notification bypass or source marker is added. Tests pass generated game and
practice payloads through the actual notification handler with mocked delivery,
and prove that disabling reminders does not suppress creation announcements.
The atomic receipt and same-proposal reconciliation prevent repeating a
successful business save after a lost response. They **do not establish
exactly-once provider delivery**: the existing asynchronous notification pipeline
can retry, suppress or fail delivery independently. Completed receipts explicitly
report `notificationDelivery: unverified`; never repeat a schedule save to resend
notifications. A durable delivery/outbox contract and provider integration review
remain requirements before activating this path.

The shared app practice payload builder omits `scheduleNotifications` from edits
when the caller did not supply it. This preserves current reminder settings and
delivery history through both web SDK and native field-masked updates, while
explicit settings and new-practice defaults retain their existing behavior.

The RSVP domain saves only `rsvps/{currentUid}__{playerId}` for a currently
managed team, active player and ordinary event. It rechecks the team's normalized
availability cutoff before approval, inside the transaction and immediately
before commit; no staff bypass is exposed. The adapter cannot write another
responder's record, base/family response or private note. Any existing own base
response requires app reconciliation, because base responses also participate
in confirmed-member access rules. Malformed or inline-note legacy overrides
fail closed. Existing restricted notes are preserved rather than cleared.

This bounded RSVP path is not full parent/family parity. It does not recompute
cached aggregate totals, resolve all responders' effective availability, manage
private notes or reconcile legacy documents. Its receipt reports only the saved
manager override and `summaryRefresh: not_performed`. The preview discloses that
it may supersede other responses, and ordinary explicit approval is required.
No invitation, message or access-grant operation is performed. Family responses,
notes and reconciliation remain app-confirmed until their shared contracts are
implemented with privacy and access-effect review.

Roster proposal content is stored only in the team's expiring
`privateAiPendingActions` collection under existing current-manager rules.
The user-side envelope contains only actor/team/player IDs, operation, digest,
expiry and status—no player names, field values or preview. Completion atomically
writes the player change and opaque user receipt and deletes the team payload.
The shared engine accepts this domain's validated receipt after proposal expiry
without needing the deleted content, and rechecks current team access before
returning the outcome. Pending content becomes unreadable after access loss or
expiry under the existing rules; no rule change or broader access is included.
Expired abandoned payloads are not automatically deleted by this prototype;
storage cleanup remains a rollout consideration, even though the rules deny
reads. Lost successful commits reconcile from the durable receipt and do not
create a replacement player.

Practice timeline creation targets an existing active, non-recurring practice
with a valid date and no linked timeline. It creates an app-compatible draft
with empty attendance/history and no generated packet. The session ID derives
from the proposal UUID. Update targets an exact, unambiguous draft session and
changes only title/location or appends blocks; it never replaces existing blocks,
notes, attendance, schedule fields or delivery settings. Packet-assigned,
completed, cancelled, recurring and ambiguous event/session states fail to the
app. Creation inherits the event date and, unless explicitly provided, location.

Each new block names a custom title or exact drill ID and explicit duration.
Selected library drills are read with the user's credentials and their revisions
are checked along with the event/session/link query. New blocks use the app's
stored order/drill/title/type/duration/description/notes contract. Limits are 30
new blocks per action, 100 total blocks and 600 total minutes. Existing malformed
block ordering/durations require app review before appending. Firestore array
transforms append only the new blocks while retaining existing values in place,
including legacy references and timestamps; an update mask changes only the
reviewed metadata and derived duration. The transaction queries event-linked
sessions to detect duplicate creation and commits the session change, opaque
receipt and pending-payload removal together. Concurrent same-event creation
and lost responses are covered by emulator tests.

`directTeamProposalStore.js` now shares the private-content/opaque-receipt split
between roster and practice domains. Coaching text remains behind the existing
team-manager and expiry rules. Discovery returns only selected event/timeline
summaries and drill options, excluding attendance and existing notes. It marks
unsupported practice events and reports multiple linked timelines as ambiguous.
This adds scoped drill discovery useful for both planning and favorites.

The existing `notifyPracticePacketAssigned` handler was executed against actual
prototype-generated create/update payloads in the test harness. It performed no
target lookup or delivery: create sets packet content to null, and update refuses
packet-assigned sessions and never writes packet fields. This is evidence for
the current code paths, not live provider validation or permission to send.

Confirmation requests a default-false approval through negotiated MCP form
elicitation; an arbitrary confirmed argument is rejected. Decline, cancellation,
missing client support, changed actor, expired/edited proposal, changed targets,
or revoked manager access prevent execution. The command checks current access
again after approval. One Firestore transaction reads target revisions and
atomically applies the reviewed domain change and its completion receipt.
Repeated calls return that receipt, and a lost commit response is reconciled
without automatically replaying the write. An unverified outcome is reported
as unknown and must retain the same proposal ID. Concurrent transactions can
both abort; a known conflict requires a new explicit approval of the still-valid
proposal instead of an automatic execution retry.

The favorite domain matches the existing document contract (`addedBy`,
`addedAt`) and immutable add/remove Firestore rules. It does not update the drill
itself, invite anyone, send communications, change financial records, or expose
arbitrary document writes. The separate bounded RSVP domain described above
adds current-manager overrides while leaving private-note and family workflows
in app review.

The opt-in transport composition is now implemented in
`directSessionTransport.js`, with `directSessionAuth.js` and
`directActionApproval.js`. Initialization, POST responses to elicitation, GET
streams, DELETE, and tool calls authenticate against the broker grant. Sessions
bind the verified user, authenticated OAuth client ID, and a hash of the exact
access grant. Raw Firebase bearers and unconsented read grants are denied.
Firebase refresh credentials are checked freshly instead of accepting the read
identity cache. Current identity is checked again before application reads and
commits. Client/grant metadata is read from the authenticated grant store, never
tool arguments; existing OAuth responses and scope grants are unchanged.

Session state is in memory, expires within ten minutes (or sooner with the
access grant), and has global/per-user capacity limits. Approval expires within
two minutes and is consumed once immediately before the commit attempt. It is
bound to the exact preview and connection; it is not returned as a reusable
model-visible token or stored as ongoing permission. Disconnecting an approval
stream invalidates the session. Restart, expiry, or use of a different access
grant requires new initialization; never automatically resume a pending approval.
Host/origin checks default to loopback-only hosts and no browser origins.

**Concrete integration decision:** keep this router unmounted in production.
The synthetic HTTP tests now prove authenticated session isolation and the
one-action approval contract, including an end-to-end run against emulator
accounts and real Firestore rules. They do not prove that the deployed ChatGPT
client supports the required form UI, handles reconnects, or collects approval
as expected. The protocol trusts the authenticated client to represent the user's
choice; it is not independent proof of a physical human interaction. Before
activation, review user-facing consent wording, test a designated isolated live
account, set explicit allowed hosts/origins, and decide single-instance/affinity
or distributed session routing. Current sessions fail closed on another
instance. Repeated fresh credential checks also require latency/rate-limit
validation. The account assessment below identifies a possible existing smoke
fixture, but no approved disposable ChatGPT test connection. No deployment,
credentials, access settings,
persistent grant, or production registration is included here.

1. Extend the shared command engine with additional domain schemas, current
   authorization and discovery. Full stat-schema editing, parent/family RSVP, recurring or
   packet-assigned practices, editing/removing existing timeline blocks,
   contact/access roster imports, larger or partial roster batches, complex or batch schedule
   writes, attachments and editable previews
   are still absent from the direct prototype; the 46 app-review tools cover the
   canonical writes through existing browser handlers.
2. Review execution authorization for each additional command. If a persistent
   execution capability is introduced, require a distinct explicitly consented
   scope. The bounded prototype instead requires a separate one-action approval;
   allplays.review alone never authorizes execution.
3. Persist command outcomes/idempotency at the domain boundary, including
   partial/large roster or schedule batches, notifications, invites, and provider effects.
4. Provide MCP-native previews and confirmations, then run multi-instance,
   revocation, permission, replay, and live isolated-account integration tests.

This bridge can remain as a fallback while those domains move server-side.

### Existing test-account assessment

The repository's [production smoke runbook](../../docs/production-smoke-and-email-acceptance.md)
documents dedicated `SMOKE_STAFF`, `SMOKE_PARENT` and `SMOKE_ADMIN` accounts and a
synthetic team. The role-specific environment variables are wired into the
protected `production-smoke` environment in the scheduled/post-deploy workflows.
This is evidence of an established fixture contract, not proof that credentials
are currently accessible or that the fixture is isolated enough for this test.

The verified staff account is the only plausible candidate for positive manager
workflows: it should have least-privilege owner/admin access to the synthetic
team. The parent could support negative authorization checks. The global-admin
account is unsuitable for validating least-privilege manager behavior. These are
persistent release-smoke fixtures, not documented disposable ChatGPT accounts;
connecting one to ChatGPT would create a persistent OAuth grant requiring
separate approval. Current fixture ownership, absence of real recipients/data,
concurrent smoke use, provider credential state, and cleanup arrangements have
not been verified. Do not rename a preseeded tracker configuration used by smoke
games; a future authorized run should operate on a separately designated
synthetic configuration and reconcile cleanup by stable proposal/document IDs.

No credentials were retrieved, accounts created, grants issued to live clients,
write gates changed, or fixture maintenance scripts run. The current task
prohibits production activation/data writes, so live end-to-end testing remains
pending an explicitly designated fixture/connection and authorized test route.
Emulator accounts remain the validated isolated environment for this draft.

### Direct confirmation transport findings

The installed MCP SDK is 1.32.1 and negotiates through protocol 2025-11-25.
Its server elicitation API checks client capabilities stored during
initialization. The production service still builds a fresh server/transport for every
HTTP request, without a session ID, and closes it with the response. Simply
calling elicitInput in a later tools/call therefore does not supply a working
confirmation channel. The new, unmounted session router retains capabilities
within an actor-bound session and requires new initialization after restart.
Do not infer support in the connected ChatGPT client from SDK availability or
the synthetic HTTP tests.

OpenAI's [MCP server guidance](https://developers.openai.com/plugins/build/mcp-server)
states that annotations inform client safety behavior but do not replace
server authorization, validation, or confirmation. A caller-supplied confirmed
boolean or copied confirmation nonce is not evidence that the displayed payload
was approved. The [MCP elicitation specification](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)
provides an explicit user-interaction mechanism, subject to client capability
negotiation. Any future execution path must bind its response to the actor and
exact prepared revision, handle decline/cancel without effects, and retain the
app review fallback when supported confirmation is unavailable. No new execution
scope, access settings, credentials, or transport behavior were enabled here.

Rollback to a pre-scope MCP binary keeps old read grants valid but rejects new
review-scoped grants because their authenticated encryption metadata differs.
Reconnect those clients as read-only rather than rotating secrets or weakening
grant validation.

## Unmounted delivery-journal prototype

`functions/notification-attempt-journal.cjs` now implements a server-only
notification attempt journal and Firestore storage adapter. It is **not imported
by `functions/index.js`**, has no deployed trigger/callable or configured provider
client, and is not consulted by MCP schedule receipts. Those receipts continue
to report delivery as unverified.

The ordinary notification path currently writes a five-minute dedup claim before
provider dispatch. A recent claim is neither proof of provider acceptance nor a
safe basis for retrying an uncertain send. The new journal does not wrap that
path or interpret its `null` result as delivery evidence.

The new journal stores exact bounded request parameters and a frozen audience
plan under `teams/{teamId}/notificationSendLog/durable_{hash}`. Existing rules
deny all client reads and writes there, including team managers. Device endpoints,
message bodies and provider evidence remain server-private. It accepts only
internal verified schedule-source requests, never model/client-selected sender
arguments. The required authorization callback must verify current actor scope,
source revision and exact endpoint eligibility; real production identity/source
resolution is still an integration requirement.

Each recipient/channel has an independent lease and durable provider boundary.
The first audience plan is immutable, including an empty plan: retried discovery
cannot add newly joined members or rotated endpoints. Live eligibility is checked
again before dispatch, so a frozen target can still be suppressed after access
loss. Other channels may succeed while one channel remains uncertain.

| Durable state | Meaning and safe next step |
| --- | --- |
| pending / leased | No verified provider call yet. An expired lease can be reacquired after current authorization. |
| dispatching | A durable marker was written before the external call. Lease expiry becomes uncertain, never an automatic resend. |
| retryable | A pre-dispatch failure or authoritative final rejection proves this attempt did not accept delivery. Retry uses the same exact parameters/key after a bounded delay, at most three attempts by default. |
| accepted | A final response for this exact request/attempt confirms provider acceptance. It does not prove delivery to a device. |
| uncertain | Timeout, malformed response, unreadable dispatch boundary or worker crash prevents verification. Only authoritative evidence for the exact attempt can resolve it; absence, 404 or nonfinal evidence cannot authorize a resend. |
| suppressed / failed | Current scope/source/endpoint is no longer eligible, or the bounded attempt limit was exhausted. No automatic send. |

Lost journal commit responses are reconciled before advancing. A late final
provider response can settle the matching uncertain attempt without resending.
Only bounded evidence fields are retained. Public projections contain opaque
IDs, attempt/state and acceptance certainty, never endpoint or message content.
The `reconcile` adapter is optional: providers without an authoritative lookup
leave uncertain attempts unresolved. No exactly-once device-delivery claim is
made.

The unmounted `schedule-delivery-coordinator.cjs` now checks independently
verified approval/commit claims against an exact event version and digest,
reserves a private binding, and exposes authenticated bounded status functions.
A durable evidence authority now stores broker-verified approval, consumes it
once and records independently verified commit observations. Its verifier
callbacks are connected to the actual broker/session/form and credentialed
writer by an optional local adapter. Production transport is unimplemented; see
[the broker boundary review](BROKER_EVIDENCE_REVIEW.md).
`schedule-delivery-providers.cjs` pins complete versioned inbox/FCM requests,
reconciles deterministic inbox writes and leaves unknown push outcomes uncertain.
An unmounted authenticated HTTP status handler now checks broker identity,
App Check/replay, host/origin, bounded payloads and durable rate limits. A bounded
audience resolver and Firestore/Auth loader check current preferences, roles
and endpoints. No real provider client or status endpoint is configured.

See [delivery interface contracts and activation prerequisites](DELIVERY_INTEGRATION.md).
Remaining work includes the reviewed production broker-to-backend channel, canonical
member/role adapters, status route and App Check client integration, provider/native review,
and replacing the selected legacy trigger path without double delivery. No new
client rule, MCP Admin credential, persistent grant, production registration or
live provider call is included.

See [the proposed dependent review slices](REVIEW_SLICES.md) for how to review
this server-only core independently while keeping one producer and the existing
integration draft. The stack itself has not been published or handed off.

## Local validation

Validated with isolated fixtures, without production team/game writes:

- Latest boundary stage: 350 MCP unit/protocol tests across 14 files, including
  13 opaque evidence adapter tests. The separate hardening commit passes 337
  tests in a clean archive; all 16 new hardening regressions fail on the prior
  source. No new action domains were added during this security review stage.
- Earlier domain baseline: 289 app schedule/review tests, including web/native reminder preservation,
  explicit reminder settings, stale previews, concurrent confirmation and explicit
  confirmation of only remaining partial-import rows. The new omission regressions
  failed on both web/native before the fix and pass after it.
- 72 Firestore emulator tests against the existing rules, including review
  ownership, enforced verified-email policy, real REST roster pagination, and
  denied roster queries after manager revocation, actual direct-favorite REST
  transactions, revocation during approval, lost commit responses, and
  concurrent confirmations, and broker-bound HTTP approval through an actual
  REST transaction with isolated emulator accounts, configuration clone/rename
  through authenticated HTTP, projected pagination, field-mask preservation,
  revision conflicts and lost configuration-creation commit responses; roster
  creation/update over authenticated HTTP, pending-payload access loss/expiry,
  legacy restricted-field preservation, lost creation responses and concurrent
  same-name additions; practice discovery/create/append through authenticated
  HTTP, exact event/drill revision conflicts, packet/access guards, preserved
  Firestore reference/timestamp values, lost responses and concurrent same-event
  timeline creation; maximum mixed roster batches, opaque array receipts, declined
  batches, rejected-commit atomicity, companion tampering and duplicate-name races;
  broker-bound batch approval and schedule staging without event writes; direct
  game/practice saves, field preservation, separate notification approval over
  authenticated HTTP, duplicate schedule races, rejected commits and lost-response
  reconciliation; scoped RSVP records, preserved private notes, base-response
  rejection and cutoff checks immediately before commit; server-only notification
  journal privacy, independent-worker leases, frozen plans, restart reconciliation
  and actor/recipient revocation; real event updateTime binding, concurrent
  delivery, private approval/provider records and recipient-only inbox reads;
  actual broker/form/user-credentialed commit integration, wrong-user writes,
  lost responses and forged versions that cannot create backend send authority.
- 103 Node tests for the journal, evidence/status/audience integration, provider adapters and existing Diamond notification sender,
  covering lost journal responses, uncertain provider outcomes, bounded retries,
  concurrent workers, late evidence, frozen/empty audiences, channel isolation
  provider-error privacy, mismatched/expired approval evidence, pinned provider
  payloads, false persistence results authenticated bounded status, one-use durable evidence under concurrent workers,
  replayed App Check, token-rotation-safe rate limits and complete canonical audiences.
- 145 existing notification tests across category dispatch, load, triggers and
  media batches.
- Production app build, production artifact guard, and cold-start budget check.
- Two local module-mocked browser checks for the schedule editor and practice hub.
- Built-app signed-out browser smoke preserving the review destination.
- Synthetic browser preview exercising the actual review component's prepare
  and confirm flow, with no page errors and one call at each step.

Full CI, native-device validation, and a deployed isolated-account integration
smoke remain outstanding. This change exceeds the usual 500-line review target
because scoped OAuth persistence, MCP staging, app confirmation, and their
boundary tests form one usable end-to-end workflow. Catalog data and tests are
kept separate from the small execution adapters to make review manageable.
