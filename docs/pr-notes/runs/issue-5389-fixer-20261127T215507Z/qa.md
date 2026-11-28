# QA analysis

The requested `allplays-qa-expert` skill was unavailable, so this analysis applies the assigned senior QA and regression-guardrail role directly.

## Regression strategy

Use two distinguishable players on the selected team and exercise the second player. After roster rendering, verify both options, the blank chooser value, disabled submission, and an empty request capture. After explicit selection, verify enabled submission and the exact captured payload.

## Failure modes covered

- The first roster player is preselected.
- Submission becomes available before an explicit choice.
- Roster or team selection triggers a request.
- Submission ignores the selected second player and sends the first player.

## Focused validation

Run only `tests/smoke/app-parent-tools.spec.js` against the local Vite server, filtered to the Parent Tools hub test. The existing global `test.use` configuration proves the 390x844 touch conditions.
