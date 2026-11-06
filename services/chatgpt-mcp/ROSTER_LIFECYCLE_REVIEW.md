# Atomic roster deactivation and reactivation

This checkpoint extends the existing `apply_roster_import` counterpart with
single-player and grouped lifecycle changes. Coverage remains **20 of 46 app
workflow names partially direct**, with **26 app-review-only**. It follows the
[tracking operations checkpoint](TRACKING_OPERATIONS_REVIEW.md). All direct
paths remain unmounted, including sensitive profile and RSVP-note paths.

## Operation contract

Use `get_team_roster` to discover exact active/inactive player IDs.
`prepare_roster_player_active` accepts one exact player and explicit active
boolean. `prepare_roster_lifecycle_batch` accepts 1–20 distinct exact player IDs
with mixed active booleans on one managed team. Both use
`confirm_roster_lifecycle` and `get_roster_lifecycle_action` with the same proposal
UUID. Preparation never changes the roster.

The form shows each selected player's ID, name and prior/new active state.
Ordinary approval plus the separate default-false `rosterLifecycle`
acknowledgement are required. Every selected change and the receipt commit
atomically, or none. Duplicate IDs, unsupported fields and already-matching
rows are rejected. A no-op row cannot reset an old deactivation date. After an
uncertain result, check the same proposal rather than generating a replacement.

Deactivation sets `active: false`, `deactivatedAt` and `updatedAt`. Reactivation
sets `active: true`, deletes only `deactivatedAt`, and updates `updatedAt`.
Deletion uses an exact REST field mask with that one omitted field, matching
the app's `deleteField()` behavior. Whole-record replacement, player creation,
document deletion, private profile reads/writes, and broad masks are forbidden
in this adapter. Other roster updates remain separate confirmed operations.

## Effects that require explicit review

Deactivation removes a player from active-roster views and can hide the player
from active selectors and family schedules. Existing family links and document
permissions are not removed: **deactivation is not access revocation**. The
actual rules test confirms a linked parent retains access to the child's
private profile after deactivation.

Active status also affects existing public RSVP-link usability, family-share
calendar contents and future active-player communication eligibility. Those
paths may stop on deactivation and resume on reactivation under current app
checks. The preview and extra acknowledgement disclose this. No token/link,
recipient list, permission, credential or notification record is edited by the
command, and it performs no send. Reactivation's implications for existing
links and future delivery remain part of the preactivation security review;
no live behavior is enabled here.

Existing games, RSVPs, assignments, completion history, photos, private profiles
and family links are not rewritten. Tests verify that a concurrent unrelated
private-profile edit is retained. No roster-player write trigger was found in
the inspected Functions entrypoint; downstream read-time filtering still
applies, which is why those effects are disclosed rather than claiming no
behavioral impact.

## Authorization, preservation and parity

Both paths require current manager authorization, an available team and existing
players with supported lifecycle state. Missing `active` means active, matching
the app; malformed flags, selected deleted players, invalid deactivation markers
and active players carrying a stale deactivation marker require app review.
Team and every selected player revision are bound to the proposal and re-read
inside the user-credentialed REST transaction. Current Firestore rules remain
authoritative; no rules or grants change.

Only name, ID and requested lifecycle state enter the preview. Existing private
or legacy-sensitive roster values are neither copied into the proposal nor
modified. Field masks preserve stored timestamps, document references, custom
fields and media exactly on the server. Full proposal content stays in the
manager-authorized team document; personal metadata/completed receipts contain
opaque IDs and status. Completion removes the team proposal atomically.

Tests execute actual `deactivatePlayer`, `reactivatePlayer` and
`applyRosterCsvImportOperations` helpers from `js/db.js` with isolated I/O stubs.
These are also used through the React roster service/adapter boundary. Additional
regressions execute the actual family-share child resolver, team-email recipient
selector and public RSVP active-player guard, proving the disclosed downstream
effects before and after reactivation. No app or backend runtime is modified.

## Validation and remaining gates

The new suites pass **27 unit/protocol tests** and **10 actual-rules REST tests**.
They cover both single/batch MCP forms, mixed 20-player writes, explicit marker
removal, preserved stored values and family access, no partial writes on stale
state or denied credentials, extra confirmation, final expiry/disconnect guards,
minimal receipts and lost-response recovery without repeating the write.
Emulator tests explicitly load repository compacted rules in a loopback demo
project with synthetic data.

The selected regression matrix passes **895 MCP tests across 27 suites** and
**274 tests across 15 emulator-backed suites**. Node 22 imports and diff checks
pass. Prior backend suite totals are historical.

Independent review, live identity/native integration, production contention,
credential custody and multi-instance composition remain open. Existing-link
and future-delivery effects require review before this path is mounted. Bounded
expired/abandoned sensitive-text cleanup and client/transcript retention remain
hard privacy gates for profiles and RSVP notes. Production remains unmounted;
no credentials, access grants, live data, PR metadata or additional PRs changed.
The sole draft remains #5153.
