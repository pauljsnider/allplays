# Linked-parent private profile text

This checkpoint follows [draft block content editing](PRACTICE_BLOCK_CONTENT_REVIEW.md).
It adds a bounded counterpart to `update_player_profile`, bringing coverage to
**20 of 46 app workflow names partially direct**, with **26 app-review-only**.
Existing supported names still have unsupported variants. The direct router
remains unmounted; this is not a production feature or a full parity claim.

## Supported operations

`prepare_linked_player_private_profile` accepts exact `teamId`, `playerId`, a
UUID v4 `proposalId`, and a nonempty `changes` object containing only:

- `emergencyContactName`: trimmed text, up to 120 characters.
- `emergencyContactPhone`: trimmed text, up to 60 characters.
- `medicalInfo`: trimmed text, up to 2000 characters; line breaks are allowed.

An explicit empty string clears only the named field. Omitted fields are never
cleared or copied into the proposal. The command can create a missing private
profile or patch selected fields in an existing one. Photos, media cleanup,
household contacts, roster display fields, invitations and access changes are
excluded. Staff-only access and legacy-only parent links use app review.

`confirm_linked_player_private_profile` requests the exact preview through the
existing one-action MCP form authority. Both ordinary approval and the separate
default-false `privatePlayerProfile` acknowledgement must be true. The preview
explains that authorized team owners/admins and **all parents linked to this
exact player** can read the resulting profile. It does not claim author-only
privacy. A conversational yes or model-supplied `confirmed` argument cannot
execute the change. `get_linked_player_private_profile_action` checks the same
proposal UUID after interruption; do not create a replacement for an unknown
outcome.

## Scope, preservation and source parity

Current context must identify the actor as a parent for the selected team.
The user's current `parentTeamIds` and exact `parentPlayerKeys` must both match.
This is deliberately stricter than the underlying private-profile rule, which
checks the exact player link. The team and player must exist; an inactive player or inactive/archived team
is refused. Parent, team, player and private-profile revisions are bound
to the proposal and re-read in the user-credentialed REST transaction. Existing
rules remain authoritative; no role, grant or rule is changed.

The implementation follows `update_player_profile` and its merged-argument
helper in `apps/app/src/lib/privateAiService.ts`,
`updateParentPlayerEditableProfile` in `playerService.ts`, and
`updatePlayerPrivateProfile` in `js/db.js`. It uses the same private
`emergencyContact.name`, `emergencyContact.phone` and `medicalInfo` fields and
explicit blank-text behavior. Tests execute the actual legacy writer with
isolated I/O stubs. No app runtime changes are included.

Existing documents use exact nested field masks, preserving omitted contact
fields, nested extensions, household fields, photo cleanup paths, original
nanosecond timestamps and document references on the server. A full-record set
is allowed only after the same transaction verified the profile was missing.
Replacing non-text legacy values in a selected field, or a non-map emergency
contact container, is refused. Unselected legacy fields remain untouched.
The adapter rejects extra fields, broad masks, whole-record replacement,
public roster writes, deletes and unrelated private-document paths.

Only user-supplied new text enters the proposal and form. No existing medical
or contact text is copied into a personal proposal, error or status response.
Completion atomically replaces the pending record with a minimal receipt that
contains no text or preview. The receipt is evidence only of the profile write,
not authority for notifications or any backend action. No notification trigger
for this private-profile path was found in the inspected Functions entrypoint;
this command performs no provider or message call.

## Privacy and activation gates

Pending proposals contain the new user-supplied private text. Five-minute
execution expiry does **not** erase that text or revoke the user's raw access to
its pending document. No TTL policy or cleanup worker is configured by this
change. This is an explicit **pre-activation privacy gate**, shared with the
RSVP-note prototype: review and implement bounded retention, expired/abandoned
proposal cleanup, and client/transcript retention expectations before mounting
these tools. Completion minimization is not a substitute for that cleanup.

Independent review of this batch, real identity and native client integration,
actual production contention, credential custody and multi-instance session
composition remain open. The real approval authority and guarded REST writer
must be used in production; synthetic adapters are not substitutes. Notification
provider internals, audience readiness and single-consumer rollout remain
separately gated. No production activation, credentials, permissions, live data,
payment behavior, PR metadata or additional PRs are changed. Draft #5153 remains
the only workstream.

## Validation

The new unit/protocol suite passes **42 tests** and the new actual-rules REST
suite passes **16 tests**, using only synthetic data in a loopback demo project.
The emulator suite explicitly loads the repository's compacted rules; it does
not rely on the emulator's permissive startup defaults. Coverage includes
creation, replacement and explicit clears; omitted/nested field preservation;
restricted audiences and private proposal reads; current links and revocation;
stale and competing edits; denied/unverified final commit credentials; distinct
confirmation; expiry/disconnect; minimal completed receipts; and lost-response
reconciliation without a second write. A regression records the unresolved
pending-text retention gate explicitly.

The selected MCP regression set passes **835 tests across 25 suites**. Node 22
direct-module imports and `git diff --check` pass. The full selected emulator
matrix passes **250 tests across 13 suites**. Prior backend test results remain
historical, not rerun by this batch.
