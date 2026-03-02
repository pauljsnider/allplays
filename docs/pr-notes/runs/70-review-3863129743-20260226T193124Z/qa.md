# QA Role (allplays-qa-expert)

## Objective
Prove the two blocking regressions are fixed and guard against reintroduction.

## Risk-Based Coverage
- Regression 1: invited admin email is persisted to team doc write path.
- Regression 2: accepting an additional admin invite does not remove existing `coachOf` team memberships.
- Security invariant: admin invite still marks access code as used after successful redemption.

## Validation Commands
- `cd /home/paul-bot1/.openclaw/workspace/repos/pauljsnider/allplays`
- `./node_modules/.bin/vitest run tests/unit/accept-invite-flow.test.js`

## Acceptance Criteria
- Unit suite passes with explicit assertions for `updateTeam` persistence.
- Unit suite passes with explicit assertions for additive `coachOf` merge behavior.
- Existing validation-fail path still does not mark access code as used.
