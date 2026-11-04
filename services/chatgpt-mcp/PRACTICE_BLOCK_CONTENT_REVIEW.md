# Draft practice block replacement and removal

This follows the [staff RSVP notes checkpoint](FAMILY_RSVP_NOTES_REVIEW.md).
It extends the existing `save_practice_timeline` counterpart with complete
selected-block replacement and removal. Coverage remains **19 of 46 app workflow
names partially direct**, with **27 app-review-only**. No new canonical action
name is counted, and full parity is not claimed.

## Operation contract

Use `list_practice_block_outline` to obtain current indices, then
`prepare_replace_or_remove_practice_blocks` with the exact team, event and
session IDs. Supply `blockReplacements` entries containing `{ order, block }`,
`removeBlocks` containing original indices, or both. A replacement is a complete
custom block (`title`, `duration`, optional `type`/`description`) or an exact
available `drillId` with explicit duration and optional content overrides.

At most 30 distinct blocks may be affected in one proposal. Indices always
refer to the original reviewed order. A block cannot be replaced and removed
in the same proposal; duplicate/out-of-range indices, mixing these changes with
append/reorder/retime operations, and removing every block are rejected. The
remaining blocks are renumbered and total duration recalculated, with a maximum
of 600 minutes. Each block remains 1–120 minutes; the session scan is bounded to
100 blocks. Existing creation, append, title/location, duration and reorder
commands continue to work.

The preview shows the complete discarded/replacement planning content, original
indices, final replacement indices and resulting outline/duration. The existing
`confirm_practice_timeline` additionally requires a separate default-false
`practiceBlockContent` form acknowledgement for these operations. This approval
covers the displayed replacement/removal only. A conversational yes, model
`confirmed` argument or ordinary approval without the extra checkbox cannot
execute it. Check `get_practice_timeline_action` using the same proposal UUID
after an interruption; never reapply original indices under a new proposal to
resolve an uncertain result.

## Preservation and authorization

The command requires current manager authorization, an ordinary non-recurring
practice event and exactly one linked draft session without an assigned packet.
Imported, linked, cancelled/active events and other session states require app
review. Fresh team/event/session/query and selected-drill revisions bind the
approval. Only community/published or same-team readable drills may supply new
content; actual user-credentialed Firestore rules remain authoritative.

Every existing block must have the canonical primitive schema with an empty
historical notes log. Selected blocks must also have empty coaching notes.
Untouched plain-text notes are retained exactly. Historical logs or unknown
extensions anywhere in the block array require app review; no value is silently
dropped or lossy-cloned. Replacement creates a new block snapshot; removal drops
only the explicitly approved planning content of the selected empty-note block.

A field-mask patch changes blocks, duration and the update timestamp. Attendance,
its exact stored timestamps, unrelated AI context, references, packet state and
the scheduled event remain untouched on the server. Full action content stays
in the existing manager-only team proposal. Personal metadata/receipts contain
opaque identifiers and status; completion removes the team payload atomically.
Lost responses reconcile the same receipt without repeating a removal.

The implementation follows `privateAiService.ts`,
`practiceTimelineService.ts` and the practice-session writer in `js/db.js`.
Tests invoke the actual TypeScript block normalizer and duration helper with
only its I/O adapter mocked. The existing packet-notification guard regression
remains in the selected suite; all supported sessions have no packet content,
so this path does not request packet delivery or messages. No backend source,
rules or deployed consumer changed.

## Validation and remaining gates

The selected set passed **793 MCP tests across 24 suites** and **234 tests
across twelve emulator-backed suites**. This includes 41 new unit/protocol cases
and 17 new rules cases. Tests use synthetic data and a loopback demo project,
explicitly loading the repository's compacted rules. Node 22 direct-module
loading and `git diff --check` passed. The prior 353 backend tests are historical.

Coverage includes mixed original/final indices, the 30-block bound, custom and
library replacements, explicit destructive-content approval, strict schemas,
notes/history refusal, exact untouched-state preservation, denied credentials,
revocation and stale drills/sessions, conflicting proposals, no partial writes,
disconnect and lost-response recovery. Existing practice attendance/precision,
RSVP privacy and incentive history suites remain in the regression run.

Independent review of this batch, actual production contention, live identity
and native/MCP integration, credential custody and mounted multi-instance host
composition remain gates. Notification rollout remains separately gated. Pending
RSVP-note cleanup after expiry is explicitly retained as a privacy gate in the
previous checkpoint; this batch does not introduce or claim a retention cleanup.
Production remains unmounted. No credentials, access, live data, payments, PR
metadata, deployments or additional PRs changed; the sole draft remains #5153.
