Recommendation: introduce one shared helper module for stat-config normalization and derived analytics, then adapt pages to consume it.

Current architecture:
- `statTrackerConfigs` are effectively untyped documents.
- Live trackers and reports only read `columns`.
- Team/player analytics compute directly from aggregated stat keys.

Proposed architecture:
- New helper module owns:
  - config normalization from legacy `columns` plus optional advanced definitions
  - safe formula evaluation for derived stats
  - season stat aggregation and leaderboard generation
- `createConfig()` normalizes before persistence.
- UI pages read normalized configs and use helper output instead of ad hoc stat-key discovery for advanced analytics.

Blast radius:
- Low for game tracking because `columns` remains intact.
- Moderate for analytics pages because new rendering depends on config availability and stat shapes.

Controls:
- Keep formulas read-only and expression-limited.
- Preserve existing `columns` order and legacy behavior.
- Ignore invalid derived definitions rather than breaking page render.

Rollback:
- Revert helper wiring and stored `statDefinitions` usage; legacy `columns` path continues to function.
