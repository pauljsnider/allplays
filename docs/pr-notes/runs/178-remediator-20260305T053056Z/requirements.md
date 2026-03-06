# Requirements Role Notes
- Objective: Fix PR #178 review thread PRRT_kwDOQe-T585yO9RL by correcting standings transformation in `team.html`.
- Constraint: Minimal targeted code change only; no unrelated refactors.
- Expected behavior: Native standings input must preserve correct home/away team assignment so win/loss and PF/PA are computed correctly.
- Acceptance: Away games (where current team is not home) no longer flip outcome in `computeNativeStandings`.
