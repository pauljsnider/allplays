Problem Statement
PR #557 needs review remediation for tracker finish behavior. The branch already contains fixes for case-insensitive stat normalization and split aggregated-stats batching, but the review threads remain unresolved and need explicit regression coverage plus confirmation that finish preserves completion data.

User Segments Impacted
- Coach running the live tracker during a game.
- Team admin reviewing saved player histories after the game.
- Parents consuming completed game stats and summaries.

Acceptance Criteria
1. Configured stat columns normalize to lowercase without losing values when source stat keys are uppercase or mixed case.
2. Scoreless rostered players still receive zeroed configured stats in aggregated history.
3. Non-configured stat keys already present in player stats remain preserved.
4. Finishing a game keeps the primary game completion writes within Firestore batch limits.
5. The finish flow commits the historical completion data before secondary aggregated-stats batches so the core game result is persisted first.

Non-Goals
- No refactor of tracker UI, roster flow, or Firestore schema.
- No new automation framework.
- No changes to non-tracker pages.

Edge Cases
- Source stats with uppercase keys like PTS/REB.
- Mixed-case keys across historical data.
- Large game logs near Firestore's 500-write limit.
- Rostered players with no tracked events.

Open Questions
- None blocking for this remediation. The current branch state already addresses the underlying review concerns; this pass mainly hardens regression coverage and finish ordering.