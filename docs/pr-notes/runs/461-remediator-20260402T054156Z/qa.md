Validation target:
- Prove that a multi-team tie which splits into a 2-team subgroup restarts with `twoTeamTiebreakers`.

Test plan:
1. Add a unit test in `tests/unit/native-standings.test.js` where a 3-team tie is partially resolved, leaving 2 teams tied.
2. Make the remaining 2-team direct result disagree with the next multi-team fallback rule so the regression is observable.
3. Run `npx vitest run tests/unit/native-standings.test.js`.

Residual risk:
- There is no broader integration harness for rendered standings pages, so validation remains unit-level for this remediation.
