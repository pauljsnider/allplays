# Requirements

- Objective: fix PR #497 review feedback in live-game replay init transform.
- Current state: test transform rewrites a hard-coded import signature that no longer matches source after adding renderOpponentStatsCards.
- Proposed state: transform matches current import or is resilient to import-list changes, with no unrelated behavior changes.
- Risk surface: limited to replay-init unit test harness and live-game replay module loading.
- Assumptions: only this thread is unresolved; minimal targeted fix is preferred.
