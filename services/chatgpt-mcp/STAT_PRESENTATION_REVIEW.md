# Stat presentation creation and updates

This checkpoint extends `save_stat_configuration`; coverage remains **20 of 46
workflow names partially direct**, with **26 app-review-only**. It follows the
[roster lifecycle checkpoint](ROSTER_LIFECYCLE_REVIEW.md). All direct routes
remain unmounted and no credentials, grants or live data are changed.

## Supported operations

`get_stat_presentation_options` reads stat IDs, labels and current presentation
settings for either one exact managed-team configuration or one reviewed preset.
Choose exactly one `configId` or `presetId`.

`prepare_customized_stat_preset` creates a basketball, soccer, football or
volleyball preset with a new name and selected presentation changes.
`prepare_stat_presentation_update` changes the same fields on an existing
configuration whose structure still matches one of those reviewed presets.
Both accept 1–20 unique stat IDs (bounded by the selected preset) and only:

- `format`: `number` or `percentage`.
- `precision`: an integer from 0 through 6.
- `rankingOrder`: `asc` or `desc`.

Use `confirm_stat_presentation` for one-action form approval and
`get_stat_presentation_action` with the same UUID after interruptions.
Preparation never applies the change. Names are required only for creation;
rename remains a separate workflow. Unsupported/missing stat IDs, duplicates,
unknown fields and already-matching update settings are refused.

Custom formulas, labels/acronyms, stat identities, columns, scoring, visibility,
scopes, Top Stat selections, arbitrary schemas and Diamond configurations remain
outside this path. Existing preset-compatible presentation customizations may
be edited again. Structural matching is exact; unknown extensions are refused
rather than silently normalized or dropped.

## Public and historical effects

Both public-metadata and stat-presentation acknowledgements are required in
addition to ordinary approval. Configuration metadata is publicly readable even
on a private team. The create preview shows the complete new configuration;
updates show each selected stat's prior/new settings. The actual rules tests
verify anonymous access to newly created metadata.

Formatting and ranking changes affect existing displays, including historical
leaderboards. Percentage format **adds a suffix without multiplying the value**:
for example, 0.125 at precision 2 displays as `0.13%`, not `12.50%`. Changing
ranking direction changes leaderboard order without changing underlying values.
New configurations may be automatically selected by analytics. Those effects
are explicit in the form; no game is assigned to a new configuration.

The older clone and rename commands now also require the existing
`publicConfiguration` acknowledgement. Their previews disclose public metadata;
clone additionally discloses possible automatic analytics selection. Their write
payloads and schema scope remain unchanged. Old pending previews without this
acknowledgement no longer match the current preview and must be prepared afresh.
Already completed outcomes remain idempotent and are not re-executed.

## Authorization and preservation

Current manager authorization, team/configuration revisions, one-use form
approval and final dispatch guards use the shared command architecture.
Creation scans at most 100 existing configurations for normalized duplicate
names; an oversized or stale scan fails closed. New IDs derive from proposal
UUIDs, and the transaction must observe absence before creating the target.

Updates patch only `statDefinitions` and `updatedAt`. Every non-presentation
attribute of every definition is retained byte-for-byte in the primitive schema.
Other top-level values and stored creation timestamps remain on the server.
Games, recorded stats, references, formulas, visibility and permissions are never
written. The adapter rejects whole-record replacement, arbitrary paths, deletion,
scoring patches and definition structures outside the reviewed presets.

New proposal content stays behind team authorization, with opaque personal
metadata and minimal completed receipts. Completion removes the team payload
atomically. Unknown commit outcomes reconcile the same receipt without repeating
writes. The older clone/rename storage model is unchanged by its acknowledgement
hardening; no broader migration is claimed.

Tests execute actual preset normalization, advanced-definition serialization and
parsing, formula evaluation, leaderboard rendering/sorting and analytics selection
from the shared app modules. They show raw values/formulas stay fixed while the
approved presentation changes take effect. No app or backend runtime is modified.

## Validation and remaining gates

The new presentation suites pass **38 unit/protocol tests** and **15 actual-rules
REST tests**. Two additional unit regressions verify that both older clone and
rename commands reject confirmation without public-metadata acknowledgement.
Rules tests use synthetic data in a loopback demo project with repository
compacted rules explicitly loaded. They cover all four preset schemas, all
available stat rows, private-team public metadata, stale revisions, duplicate
creation, denied/unverified final credentials, atomic receipts and lost-response
reconciliation.

The selected regression matrix passes **935 MCP tests across 28 suites** and
**302 tests across 17 emulator-backed suites**, including the older clone/rename
HTTP and rules suite affected by acknowledgement hardening. Node 22 imports and
`git diff --check` pass. Prior backend suite totals are historical.

Independent review, real identity/native integration, actual contention,
credential custody and multi-instance composition remain open. Existing-link
and future-delivery effects from roster lifecycle remain in activation review.
Bounded sensitive-text cleanup and client/transcript retention are hard privacy
gates for profiles and RSVP notes. Production remains unmounted. No deployment,
credentials, access grants, live data, PR metadata or additional PRs changed;
the sole draft remains #5153.
