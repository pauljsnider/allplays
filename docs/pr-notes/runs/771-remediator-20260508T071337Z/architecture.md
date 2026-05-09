# Architecture notes

- Subagent spawn was unavailable in this environment, so inline architecture analysis was used.
- Keep ordering centralized in getGameDayPeriods(), because renderGDPeriodTabs() consumes that list for display and fallback selection.
- Put the reusable comparator in js/game-day-periods.js beside normalizeActivePeriod so it can be unit tested.
- Sort by base period, numeric suffix, then substitution minute; fall back to stable label comparison.
- No Firebase, storage, or access-control surface changes.
