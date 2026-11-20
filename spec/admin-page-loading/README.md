# Legacy admin page initial-load repair

## Evidence and scope

On master 363d25423, team.html awaited getAllUsers() (every 100-record page of the global users collection) before its header/schedule. This was used only to discover legacy helper links for Game-day helper access. The scan originated in #857 (2d0e462d), not shared authentication. Modern dashboard initial team reads are paginated and auth enrichment is owner/parent scoped; there is no evidence that one shared scan explains all reported pages.

This repair:
- Renders directly linked helper candidates without global-user discovery. Legacy discovery remains explicitly available, loading/error states do not claim completeness, and original auth generation checks prevent stale grants.
- Removes unrelated chat badge reads from team/roster critical rendering.
- Bounds schedule enrichment to six concurrent event workers instead of serially waiting on every event. All records, authorization checks and sorted output remain.
- Renders authoritative roster names/numbers before optional panels and contact/action hydration, explicitly labeling pending fields. Existing #5093 registration pagination remains separate and untouched.

## Remaining work / limitations

This is a first-render repair, not a proven solution to every reported page. Team game history, external calendar/standings, roster private-profile hydration and parent-contact reads still need measured investigation. Explicit legacy discovery still scans user profiles and can remain slow. Permission rules and data completeness must not be weakened in replacing it with indexed lookup.

No production latency measurements were obtained: signed-in browser access was unavailable while Mac was locked. Do not report production improvement until the exact release has passed deployment gates and a signed-in admin device has been measured.

## Validation

Focused units cover delayed optional roster reads, bounded concurrency/order/failure, helper discovery authorization/stale contexts/error states and schedule field preservation. Run the full root unit suite and affected team schedule/fallback/roster browser smoke suites; retain exact-head results in the PR. Cache-bust guard remains mandatory even though db/auth/utils are unchanged.
