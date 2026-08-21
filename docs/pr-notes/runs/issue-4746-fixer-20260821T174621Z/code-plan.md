# Code Role

## Patch Plan

- Add a backend-equivalent `canPurchaseTeamPass` projection to `TeamDetailModel`.
- Add an authenticated web/native Team Pass checkout wrapper with exact inputs and shared Stripe URL validation.
- Add role-aware CTA visibility, ref-backed duplicate prevention, pending/error/retry UI, trusted navigation, and checkout-armed resume refresh.
- Add a premium access refresh version.
- Add focused component, service, and hook regressions.

## Code Changes Applied

None by the role subagent. The main run owns all edits.

## Validation Run

The role subagent ran no commands. The main run will execute the focused component, service, hook, Stripe validator, and app build commands listed in `qa.md`.

## Residual Risks

- `canManageTeam` is too broad because it includes platform admins and legacy owners rejected by checkout.
- The callable remains the security boundary.
- Refresh must arm before external navigation and clear on launch failure.
- State alone does not block rapid duplicate clicks; use a synchronous ref.
- Missing current season must never fall back silently.
- Resume lifecycle covers visibility and native app-state returns; a focus-only browser lifecycle remains a manual coverage point.

## Commit Message Draft

`Add Team Pass checkout to team details (#4746)`
