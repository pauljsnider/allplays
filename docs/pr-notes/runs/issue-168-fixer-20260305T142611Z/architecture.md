# Architecture Role Synthesis (Fallback)

Root cause:
- `init()` sets `currentTeamId` and edit title before team existence validation.
- `if (team)` branch populates page, but missing-team branch is absent.
- Submit handler relies on `currentTeamId` truthiness to call `updateTeam`.

Minimal safe patch strategy:
- In `init()`, after `const team = await getTeam(teamId);`, add explicit missing-team guard:
  - `alert(...)`
  - reset `currentTeamId = null` defensively
  - `window.location.href = 'dashboard.html'`
  - `return`
- Keep existing permission check and valid-team behavior unchanged.

Why this is minimal:
- No new modules or API changes.
- Preserves current page contract and routing model.
- Prevents broken state at source (initialization), not just submit-time.

Control equivalence:
- Access control remains as implemented by `hasFullTeamAccess`.
- Missing-team now handled similarly to denied access and unauthenticated redirects.
