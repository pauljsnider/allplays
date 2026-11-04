# Volunteer assignment lifecycle batch

This extends the [tracking-status checkpoint](TRACKING_STATUS_PARITY_REVIEW.md)
with a coherent staff/parent lifecycle: create, update/rename, remove, claim and
release. It remains an unmounted prototype in the existing draft. Production
MCP and Functions entry points, rules, credentials and access are unchanged.

## Current direct coverage

The source-compared catalog still contains 46 app write workflow names. **11 have
some direct prototype coverage; 35 are app-review-only.** Coverage is bounded,
not full parity for each name, and none of the direct tools is deployed.

| App workflow | Direct scope |
| --- | --- |
| `set_team_drill_favorite` | One manager favorite change |
| `save_stat_configuration` | Clone or rename a supported configuration |
| `apply_roster_import` | Basic roster fields, single or atomic batch up to 20 |
| `save_practice_timeline` | Draft creation, title/location update and block append |
| `create_schedule_event`, `update_schedule_event` | Ordinary game/practice saves, including isolated signed backend composition |
| `save_team_tracking_item`, `set_player_tracking_status` | Private active item text and one active player's canonical completion record |
| `manage_schedule_assignment` | **New:** ordinary-event slot create, complete replacement/rename and removal; atomic affected-claim cleanup |
| `claim_assignment`, `release_assignment` | **New:** canonical linked parent claims an open slot or releases only their own claim |

The 35 app-review-only names are:
`apply_schedule_import`, `cancel_ride_request`, `cancel_schedule_event`,
`complete_game_wrapup`, `create_family_share_link`, `create_household_invite`,
`create_ride_offer`, `create_team`, `create_team_fee`, `invite_roster_parent`,
`invite_team_admin`, `mark_player_incentive_paid`, `mark_practice_packet_complete`,
`prepare_resource_packet`, `request_ride_spot`, `resend_roster_parent_invite`,
`retire_player_incentive_rule`, `review_registration`, `revoke_family_share_link`,
`save_player_incentive_rule`, `save_practice_attendance`, `save_practice_packet`,
`send_rsvp_reminder`, `send_team_email`, `send_team_message`,
`set_player_incentive_cap`, `set_ride_offer_status`, `submit_access_request`,
`toggle_player_incentive_rule`, `update_family_share_calendars`,
`update_game_score`, `update_player_profile`, `update_rsvp`,
`update_rsvps_for_children`, and `update_team_settings`.
The existing staff RSVP override is not linked-child RSVP parity.

## Batch contract and safeguards

The implementation follows `createScheduleAssignment`, `updateScheduleAssignment`,
`removeScheduleAssignment` and the parent claim/release helpers in
`apps/app/src/lib/scheduleService.ts`, `claimAssignmentSlot`/
`releaseAssignmentClaim` in `js/db.js`, the shared snack read model, and the
existing Firestore rules. Staff changes patch only the event's `assignments`
field. Cleanup of old/destination claim documents and the completion receipt
are in the same user-credentialed transaction, rather than separate best-effort
cleanup calls. The exact claimants to remove are shown in the approval form.
Unrelated slots, claims, event fields and timestamp precision are preserved.

Parent claims require both current context and the exact current
`users/{uid}.parentTeamIds` membership used by rules; legacy-only context links
cannot authorize a claim. That user document, event and claim revisions are
bound to the proposal and transaction. Claims use the current profile display
name/full name, with no email fallback, and publish only the normal claim
schema. The form explicitly states that the name and account ID become visible
to team members. Managers without parent membership cannot claim; parents
cannot overwrite or release anyone else's claim.

Staff proposal details remain manager-only on the team, with opaque personal
metadata. Parent proposals use the existing owner-only personal boundary and
contain the selected role, IDs and their own display name only: no other
claimant, assignment array, event notes or contacts. Completion replaces that
proposal with an opaque receipt. Parent discovery returns role and
open/mine/claimed/fixed state without other claimant identities; manager
discovery returns supported slots without unrelated event fields.

All five operations require bound one-use form confirmation, current access and
unchanged revisions. Lost commit responses reconcile the atomic receipt;
neither business mutations nor contention failures retry automatically. Two
contending emulator transactions may both abort; the test proves the slot stays
unchanged before a new explicit confirmation. No client receipt becomes backend
notification authority. The actual game-notification category detector is
tested to return no category for assignment-only changes; no assignment-claim
trigger was found. This batch sends no messages.

## Limits and activation gates

Validation passed **521 MCP tests across 18 suites**, including 40 new assignment
unit/protocol cases, and **139 tests across six emulator-backed suites**,
including 18 new lifecycle/rules cases. The rules suites explicitly load the
repository's compacted rules. The earlier checkpoint passed 353 backend tests;
this batch changes no backend code. Focused tests also cover the app read model,
actual notification detector, strict path/delete policies, cancellations,
missing authority, tampering, revocation and lost responses.

Only canonical slot arrays up to 50 entries and ordinary scheduled events are
supported. Roles use bounded ASCII letters/digits, spaces, underscores and
hyphens, with an alphanumeric first character. Unknown fields, malformed
claims, duplicate case-insensitive names, imported/recurring/linked/active/
cancelled events and legacy memberships require app review. Parent release
requires an existing open-signup slot and the actor's own claim; stale orphaned
claims require staff/app review. No rules were broadened to accommodate these
flows.

The test evidence covers unit/protocol behavior and local demo rules, not live
ChatGPT identities or production contention. Independent review, native client
end-to-end validation, host composition, credential custody and multi-instance
session routing remain open. Notification activation still requires guards
across provider SDK awaits, real audience verification, durable recovery and
single-consumer migration. The prototype stays unmounted; the PR remains draft
with external ownership. No deployment, live writes or PR metadata updates are
part of this batch.
