# Patch Plan

1. Add failing service tests for bounded, sorted, current-team-perspective recent results.
2. Add failing component and mobile smoke coverage for populated, empty, unavailable, and narrow-screen states.
3. Add a typed recent-result selector that reuses the completed-public-game privacy filter.
4. Add isolated results state and a mobile-first card to `PublicTeamDetail`.
5. Run only the focused service, component, smoke, and compiler/import checks.

# Code Changes Applied

None at analysis time. Only the main lane will edit.

# Validation Run

Pre-change focused component and service suites passed, confirming the existing baseline. Post-change validation will rerun those exact tests plus the targeted mobile smoke and app typecheck.

# Residual Risks

- Five is the accepted bound.
- Supplemental failure must not masquerade as empty.
- No raw summary, location, tournament administration, roster, or member fields may enter the view model.

# Commit Message Draft

`Add recent results to public team profiles (#4692)`
