# QA Role (fallback synthesis)

- Requested `allplays-qa-expert` / `sessions_spawn` tooling is unavailable in this runtime; this file captures the equivalent QA lane output.
- Primary regression targets:
  - mixed-cache module loading on pages importing new `utils.js` exports
  - visibility and management of pre-existing recurring-practice ride offers keyed by legacy UID
  - parent rideshare access sync remaining strict before writes
- Evidence plan:
  - inspect branch diff from reviewed commit `4639c08761` to PR head `61a19fc580`
  - run `ics-tracking-ids`, `rideshare-helpers`, `parent-dashboard-rideshare-wiring`, and `parent-dashboard-rideshare-access-sync`
  - treat stale tests as defects in validation, not proof that the implementation is wrong
- Acceptance criteria:
  - cache-bust bump present on both affected HTML entry points
  - parent dashboard source includes legacy UID fallback plumbing on read/write/manage paths
  - focused test suite passes after aligning the stale assertion
