Objective: Remove the misleading Edit Profile affordance for users who cannot save private player profile changes.

Current state:
- `player.html` shows Edit Profile when the signed-in user is global admin, linked parent, or listed in `coachOf`.
- Firestore only allows writes for team owner, team admin email, global admin, or linked parent.

Proposed state:
- `player.html` should only show Edit Profile when the user has full team access under the shared helper or is a linked parent for that player.

Risk surface and blast radius:
- Affects one button and one modal entry point on `player.html`.
- Sensitive profile fields are involved, so false-positive access is worse than a conservative hide.

Assumptions:
- `coachOf` remains intentionally excluded from private profile write authorization.
- Parent access continues to be valid through either legacy `player.parents` or `user.parentOf`.

Recommendation:
- Reuse the shared `hasFullTeamAccess` helper in `player.html` and keep parent checks local to the page.
- Add a regression test that fails if `player.html` reintroduces `coachOf`-only gating.
