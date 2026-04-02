Requirements role
Objective: preserve the requested visible upcoming-game count after excluding cancelled games.
Current state: Firestore query limits before client-side status filtering, so cancelled records consume slots.
Proposed state: cancelled games must be excluded before the effective count is applied, while keeping the 7-day window and existing sort order.
Risk surface: homepage upcoming cards and any callers of getUpcomingLiveGames(limit). Blast radius is limited to this data fetch path.
Assumptions: game status values are stored as lowercase strings and cancelled games should never appear in upcoming/live sections.
Recommendation: prefer adding a Firestore where-clause that excludes cancelled status if supported by existing query constraints; otherwise over-fetch with a bounded buffer and trim after filtering.
Success: getUpcomingLiveGames(6) returns up to 6 non-cancelled games when enough exist within the window.
