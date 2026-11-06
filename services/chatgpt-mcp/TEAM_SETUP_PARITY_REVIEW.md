# Team details and preset creation batch

This follows the [private incentive checkpoint](INCENTIVE_PARITY_REVIEW.md).
The batch adds bounded `update_team_settings` support and extends
`save_stat_configuration` beyond cloning/renaming with reviewed preset creation.
There are now partial direct counterparts for **19 of 46 app write workflow
names**; **27 remain app-review-only**. These are implementation counts, not full
workflow parity or deployed availability.

## Implemented contract

`list_team_setup_options` returns the current manager-visible team name, ZIP,
visibility, preset IDs and bounded configuration names/IDs. It does not return
membership lists, contact details, calendar credentials or media values.

`prepare_team_details` accepts only `name` and/or `zip`. Names must be trimmed,
nonempty and at most 120 characters; ZIP must be five or nine digits, or explicit
empty to clear it. The patch changes only selected fields plus `updatedAt`.
Sport, visibility, owner/admin fields, media, calendar credentials, links,
Diamond state and unknown fields stay untouched. The preview states that details
may appear wherever the team or its shared games are shown. Inactive, archived
or malformed legacy team details require app review. This is a stricter subset
of the app's ZIP normalizer: no punctuation stripping or ambiguous lengths.

`prepare_stat_configuration_preset` creates a new named configuration using the
app's normalized basketball, soccer, football or volleyball preset. The complete
schema appears in the preview. The new ID derives from the proposal UUID;
existing IDs and normalized duplicate names fail closed. The scan refuses more
than 100 configuration documents. Baseball, softball, blank/custom schemas,
existing definition updates, game attachment and Diamond activation are not
exposed by this tool. Existing clone/rename tools remain available.

The current Firestore rules make configuration documents publicly readable,
even for private teams. The app's `selectAnalyticsConfig` also scores all
configurations by sport and top-stat definitions, so a new preset can change
which metrics appear automatically. Both effects are disclosed in the preview
and the distinct default-false `publicConfiguration` acknowledgement. The
command does not write recorded stats or game configuration references. A
conversational yes, arbitrary schema, `confirmed` argument, missing checkbox or
other model-supplied confirmation is rejected.

Both preparations use `confirm_team_setup` for real one-action form approval
and `get_team_setup_action` for recovery. Every read/commit uses the user's
credentials and existing rules. Current manager authorization, team revision and
relevant target/query revisions are rechecked. Full pending content is stored
behind current team-manager access; personal records retain only opaque IDs and
outcome metadata. Completion, business changes and team-payload removal are
atomic. Lost responses reconcile the original proposal without another write.
Whole-team replacement, unrelated paths, privilege patches and business deletion
are denied by the adapter.

## Consumer and side-effect evidence

Reviewed sources include `privateAiService.ts`, `teamDetailService.ts`,
`js/stat-config-presets.js`, `js/stat-leaderboards.js`, `js/db.js`, Firestore rules
and the team-write Functions hooks. The MCP package cannot import root web
modules at runtime, so `teamSetupPresets.json` stores the normalized output of
`getStatConfigPresetById` for the four supported IDs. Tests compare every field
against the actual app preset and verify returned copies cannot mutate the
catalog. When app presets change, regenerate this snapshot and review the
result; the parity test must pass before shipment.

Team writes invoke existing recipient-cache synchronization, even for a text
change. The actual hook is exercised with isolated candidate/cache adapters;
the test proves it forwards the same existing identity set and team state, not
that every deployed cache/provider path has been integration-tested. The
preview discloses this refresh. Owner/admin values and the public-profile staff
membership key stay unchanged. No message send is requested, and no access,
visibility, payment or production consumer setting is changed by these tools.
The preset tests execute the app's actual analytics selector to demonstrate the
disclosed display effect; existing game references and stored scores survive.

## Validation and remaining gates

The selected regression set passed **711 MCP tests across 22 suites** and
**201 tests across ten emulator-backed suites**, including 54 new unit/protocol
cases and 19 new emulator/rules cases. Emulator suites explicitly load the
repository's compacted rules under a loopback demo project. `git diff --check`
passed. The prior 353 backend tests are historical; no backend source changed.

Coverage includes preset/source parity, separate public-metadata approval,
strict schemas, manager-only discovery, team-field preservation, anonymous
configuration readability, atomic private proposal cleanup, owner/admin
success, incorrect/unverified credentials, stale and competing proposals,
expiry/disconnect, lost-response recovery and adapter restrictions. Existing
practice precision and incentive history suites remain in the regression set.

Independent review of this batch, live client/identity integration, real query
contention, trustworthy clock/credential custody, host mounting and
multi-instance routing remain gates. Notification rollout retains its separate
provider-internal checks, audience authorization, recovery and single-consumer
migration requirements. The existing AI incentive-toggle inversion remains
recorded in the previous checkpoint for a separate focused app fix.

Production entry points remain unchanged and unmounted. No real data,
credentials, access grants, payments, PR metadata, deployment or additional PR
was changed. The sole draft remains #5153 with external ownership retained.
