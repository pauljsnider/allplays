# Current app comparison and private tracking-item parity

The app's write definitions in `apps/app/src/lib/privateAiService.ts` and
`resourcePacketsAiTools.ts` contain **46 named write workflows**. The existing
MCP review-request catalog covers those same 46 names; the regression suite
compares both catalogs to the actual source definitions. Review-request coverage
means staging for review and confirmation in the app, not direct execution.
No production MCP or Functions entry point was activated by this checkpoint.

## Direct prototype comparison

| Actual app AI workflow | Current direct prototype scope | Remaining difference |
| --- | --- | --- |
| `set_team_drill_favorite` | One manager-approved favorite change | Production/client integration remains gated |
| `save_stat_configuration` | Clone a supported configuration or rename it | Arbitrary schema/formula edits and creation from scratch |
| `apply_roster_import` | Basic name/number/position create/update, single or bounded atomic batch | Family contacts, invitations, status and extended fields |
| `save_practice_timeline` | Create a draft or change title/location and append blocks | Recurring/packet-linked practices and broader timeline editing |
| `create_schedule_event`, `update_schedule_event` | Ordinary game/practice saves, including the isolated signed backend path | Recurrence, imports, linked/special engines, cancellation and full schedule settings |
| `save_team_tracking_item` | **New:** private active item creation and name/description editing | Publication, archival and legacy-item migration |

The existing staff RSVP override is not equivalent to the app's linked-child
`update_rsvp`/`update_rsvps_for_children` workflows; it must not be counted as that
family-scope parity. The remaining 39 app workflow names use app review rather
than direct execution. They include team creation/settings, access/invitations,
family sharing, ride and assignment workflows, fees/incentives/registration,
communications/reminders, attendance/packets/resources, score/wrap-up, player
tracking completion and private player profiles. This is still incomplete parity.

## Selected capability and actual schema

Private tracking items are a useful staff create/update gap with a bounded
schema, explicit existing rules and no notification dispatch dependency. The
implementation adds `prepare_create_tracking_item`, `prepare_update_tracking_item`,
`confirm_tracking_item`, `get_tracking_item_action`, and `list_team_tracking_items`
to the optional direct-session composition. The production server does not import
that composition.

The implementation follows `saveTeamTrackingItemForApp` and
`normalizeTeamTrackingItemDraft` in `teamDetailService.ts`, the legacy
`createTeamTrackingItem` producer in `js/db.js`, and the actual Firestore payload
and audit rules. One discrepancy was found during inventory: the existing AI
workflow description mentions title/type/dueDate/required, but the actual save
helper accepts name/description/visibility/status. These new MCP tools use the
actual `name`/`description` schema. That older app-description mismatch has not
been edited as part of this isolated server slice.

Creates use a deterministic proposal-derived item ID and the normal app fields:
team ID, name, description, private visibility, consistent active/status/archived
flags, and actor/timestamp audit fields. Updates patch only supplied name or
description plus update audit. Omitted text is preserved; an empty description
explicitly clears it. Creation audit, item state, and player completion documents
remain untouched. Public, archived, unknown-extension and malformed legacy items
are rejected for app review, not silently converted.

## Authorization, confirmation and privacy

The shared command engine requires current manager access, exact IDs, a reviewed
preview and a consumed one-action form approval. It rechecks team, target and
relevant list revisions after the form. Creates and renames check all tracking
items, including public/archived/legacy name aliases, and fail closed if the
bounded query exceeds 200 records. The same proposal ID cannot describe a new
intent or automatically repeat a committed mutation after response loss.

All reads and writes use the acting user's Firestore credentials and existing
rules. No new permissions, service credentials or rules were introduced. The
REST adapter limits paths to tracking items, team metadata and the shared private
proposal mechanism; it cannot reach member completion records or unrelated
business domains. Discovery projects IDs, names and state only. Proposal text is
stored under the existing manager-only team boundary, with opaque personal
headers; completion atomically deletes the team payload and keeps a minimal
receipt. No profile/contact data is copied to that receipt.

This ordinary text domain uses the existing direct user-credentialed transaction
path. It does not use the schedule signing/backend-evidence path, send messages,
create access grants, publish item visibility, perform financial operations or
write player completion status. It grants no ongoing write permission.

## Validation and remaining gates

Validation passes **450 MCP unit/protocol tests**, including 33 new tracking
cases, and **113 tests across five emulator-backed suites**, including eight
new tracking cases. **353 backend tests** passed on the preceding notification
hardening commit; this capability slice does not alter backend code. The
notification fix remains separately reviewable at `5c2239e2`.

Coverage includes real MCP form elicitation, rejected conversational flags,
permission/revision/expiry changes, public/legacy refusal, duplicate detection,
scoped adapter paths, bounded discovery, actual rules-enforced create/update,
private proposal isolation, completion-record preservation, rules-denied commit
credentials and reconciliation of a lost commit response without another write.
The actual app-schema create/update test verifies immutable creation audit fields.
These are SDK fixtures and emulator identities, not a live ChatGPT account.

Native client integration, independent review, explicit host/deployment
composition, real credential custody, multi-instance session routing and all
notification rollout gates remain open. Full app parity is not claimed. Neither
this domain nor the notification hardening changes activate production or alter
real team records.
