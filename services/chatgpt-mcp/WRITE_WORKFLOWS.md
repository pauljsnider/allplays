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

1. Extract shared server command schemas, complete domain authorization, and
   read capabilities from the browser registry; avoid copying browser writes.
2. Introduce a distinct direct-mutation OAuth scope for those commands and
   durable actor/payload-bound confirmations. The new allplays.review scope
   permits draft requests only and must never imply direct execution authority.
3. Persist command outcomes/idempotency at the domain boundary, including
   partial roster/schedule batches, notifications, invites, and provider effects.
4. Provide MCP-native previews and confirmations, then run multi-instance,
   revocation, permission, replay, and live isolated-account integration tests.

This bridge can remain as a fallback while those domains move server-side.

### Direct confirmation transport findings

The installed MCP SDK is 1.32.1 and negotiates through protocol 2025-11-25.
Its server elicitation API checks client capabilities stored during
initialization. This service currently builds a fresh server/transport for every
HTTP request, without a session ID, and closes it with the response. Simply
calling elicitInput in a later tools/call therefore does not supply a working
confirmation channel. Verify a compatible client/transport design, with
actor-bound state across restarts, before connecting it to mutation execution.
Do not infer support in the connected ChatGPT client from SDK availability.

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

## Local validation

Validated with isolated fixtures, without production team/game writes:

- 330 focused tests across MCP core, OAuth, review requests, roster discovery,
  and the existing
  private AI action service.
- 11 app review service/component tests, including stale previews, concurrent
  confirmation, and explicit confirmation of only remaining partial-import rows.
- 18 Firestore emulator tests against the existing rules, including review
  ownership, enforced verified-email policy, real REST roster pagination, and
  denied roster queries after manager revocation.
- Production app build, production artifact guard, and cold-start budget check.
- Built-app signed-out browser smoke preserving the review destination.
- Synthetic browser preview exercising the actual review component's prepare
  and confirm flow, with no page errors and one call at each step.

Full CI, native-device validation, and a deployed isolated-account integration
smoke remain outstanding. This change exceeds the usual 500-line review target
because scoped OAuth persistence, MCP staging, app confirmation, and their
boundary tests form one usable end-to-end workflow. Catalog data and tests are
kept separate from the small execution adapters to make review manageable.
