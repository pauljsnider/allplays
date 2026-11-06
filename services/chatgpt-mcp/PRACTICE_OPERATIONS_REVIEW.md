# Practice attendance and plan editing batch

This follows the [linked-family RSVP checkpoint](FAMILY_RSVP_PARITY_REVIEW.md).
The batch adds bounded `save_practice_attendance` support and extends the existing
`save_practice_timeline` counterpart with duration/order edits. There are now
bounded direct counterparts for **14 of 46 app workflow names**; **32 remain
app-review-only**. This is neither complete workflow parity nor deployed client
availability. The earlier checkpoint lists the other covered names; attendance
is the only new workflow name counted here.

## Implemented operations

`prepare_practice_attendance` and `confirm_practice_attendance` initialize or
update present/late/absent status for 1–20 explicitly selected active players in
one ordinary draft practice session without an assigned packet. Existing player
notes are preserved. Present/late retains an existing check-in timestamp or
records a new one; absent clears that selected player's check-in timestamp, as
stated in the approval. The command updates attendance counts, present-player
IDs and attendance summary consistently. Other players, schedule, blocks and
unrelated AI context remain unchanged. Status is available through
`get_practice_attendance_action`.

`list_practice_block_outline` returns current indices/titles/durations without
notes or descriptions. `prepare_edit_practice_blocks` prepares explicit duration
changes and/or a complete permutation of current block indices; the existing
timeline confirmation/outcome tools execute and reconcile it. Indices refer to
the pre-edit order. Every block, drill reference/content and note is retained;
the total duration is recomputed. Existing create/title/location/append tools
continue to work. Removing/replacing blocks and editing historical notes/logs
remain app workflows.

Both operations follow the existing React/legacy producers in
`scheduleService.ts`, `practiceTimelineService.ts` and `js/db.js`. They require
current manager access, exact team/event/session identity, an unambiguous linked
draft session and explicit one-use form confirmation. Session/event and relevant
roster revisions invalidate a stale approval. Reordering uses a canonical block
schema and refuses extended blocks or nonempty historical notes logs rather
than re-encoding potentially lossy values. Attendance refuses legacy/extended
rows, duplicate IDs, orphaned/inactive saved players and inconsistent counts.
At most 200 total roster documents are scanned; larger lists fail closed.

## Preservation architecture

The Firestore REST Date decoder ordinarily truncates sub-millisecond precision.
Attendance array updates therefore opt into a Date subclass that retains the
original wire timestamp until it is re-encoded, while default reads remain
unchanged. Its ISO representation falls back to the changed Date value if the
timestamp is deliberately modified. Attendance keeps those original Date
instances through the array merge; it must not structured-clone them before
encoding because the structured-clone Date algorithm drops subclasses. Unit
round-trip tests include nine fractional digits; the real emulator verifies
stored microseconds survive updates to both touched and untouched state.

A policy-gated field-mask patch updates the complete canonical attendance
structure but only `aiContext.presentPlayerIds` and
`aiContext.attendanceSummary`. Other AI fields and Firestore references remain
untouched on the server. Other domain adapters do not acquire arbitrary
field-mask permissions. Plan edits patch only supported plan fields, preserving
attendance timestamps and unrelated session data without re-encoding them.

Full proposals stay under the existing manager-only team boundary; personal
metadata/receipts do not copy player names or notes. Completion and receipt
write atomically; a lost response reconciles the same proposal without a second
mutation. A saved attendance change invalidates a simultaneously prepared plan
edit, requiring fresh review before that edit can execute.

## Notification and scope limits

`mark_practice_packet_complete` remains app-review-only: its actual Functions
onCreate trigger sends staff notifications and needs a separately reviewed
delivery integration. This batch neither generates/assigns packets nor writes
completion records. The actual packet-assignment guard is tested to return
before delivery for absent or unchanged packet content. All supported sessions
must have no assigned packet; no message is sent by these operations.

Notes, clearing attendance records, archived/inactive player reconciliation,
large/legacy rosters, recurring/imported/linked/cancelled events, non-draft
sessions, extended blocks and packet workflows still require app review.
The remaining app-review-only count is 32; full parity is not claimed.

## Validation and activation gates

The selected regression set passed **602 MCP tests across 20 suites** and
**164 tests across eight emulator-backed suites**. The prior 353 backend tests
are historical; this batch changes no backend source.

New coverage includes 38 unit/protocol cases and 12 emulator/rules cases:
real forms, stale revisions and revocation, denied credentials, atomic bounded
attendance, exact timestamp/reference preservation, counts, notes, block order,
loss reconciliation, field-mask restrictions and packet-trigger guard behavior.
The rules suites explicitly load the repository's compacted rules.

Independent review of this batch, live client integration, host composition,
credential custody and multi-instance session routing remain gates. Notification
rollout still requires provider-internal authorization/lease checks, verified
audiences, durable recovery and single-consumer migration. Production entry
points remain unchanged and unmounted. No live data, credentials, permissions,
PR metadata, deployment or additional PR was changed.
