# QA Role (allplays-qa-expert equivalent fallback)

Requested orchestration skill `allplays-orchestrator-playbook`, role skill `allplays-qa-expert`, and `sessions_spawn` are unavailable in this runtime. This artifact captures equivalent QA analysis.

## Regression risk
- High for parent rideshare write flow (issue symptom).
- Medium for over-broad permission if rule is relaxed too far.

## Required tests
1. New unit test that inspects `firestore.rules` and fails if rideshare create/read is not guarded by composite parent access.
2. Run targeted test file plus adjacent rideshare wiring/helper tests.

## Manual sanity checks (post-merge)
1. Parent with player link but missing `parentTeamIds` can save offer.
2. Unlinked user still denied on rideshare writes.
3. Existing driver/admin decision controls unchanged.
