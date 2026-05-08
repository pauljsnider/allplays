# Requirements notes

- Subagent spawn was unavailable in this environment, so inline requirements analysis was used.
- Acceptance: substitution period tabs are ordered chronologically for persisted rotationPlan maps.
- Acceptance: fallback active period in renderGDPeriodTabs selects the earliest chronological interval, not arbitrary object key order.
- Acceptance: sorting handles labels with base period plus minute, e.g. H1 7', H1 14', H1 21'.
- Scope: minimal change in game-day period ordering, no data model changes.
