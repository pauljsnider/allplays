Objective: add automated coverage for the highest-risk Game Day end-of-game path without broad page refactors.

Current state:
- `game-day.html` handles the live-to-completed transition and wrap-up submit inline.
- Existing `test-game-day.html` only covers replicated helper logic and misses page workflow behavior.

Proposed state:
- Extract the wrap-up transition and completion payload/redirect rules into a small helper module.
- Add Vitest coverage for those rules plus page wiring assertions so CI guards the real flow.

Risk surface and blast radius:
- Scope is limited to the Game Day wrap-up path.
- Main risk is changing completion behavior or redirect format; tests should lock both down.

Assumptions:
- Vitest is the repo's supported automated test path for CI.
- A small extraction is acceptable as the minimal code change that enables durable coverage.

Recommendation:
- Prefer a narrow helper extraction over a larger browser harness because it gives reliable automated coverage with lower maintenance cost and no new framework setup.

Success criteria:
- A focused automated test proves the completed-status transition opens Wrap-Up with current score state.
- A focused automated test proves finish flow persists final score/notes/completed flags and redirects to the match report.
