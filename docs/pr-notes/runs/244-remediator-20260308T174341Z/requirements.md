# Requirements role

- Objective: preserve parent access to historical linked seasons when building or updating athlete profiles.
- Current state: `saveAthleteProfile()` allows season keys from `user.parentOf`, but `buildAthleteProfileSeasonSummary()` drops inactive teams because it calls `getTeam(link.teamId)` with the default active-only filter.
- Proposed state: athlete profile aggregation must hydrate both active and inactive linked teams so historical seasons remain selectable and savable.
- Risk surface: narrow to athlete-profile save/edit flows; no broader team lookup behavior should change.
- Assumptions:
  - Inactive teams still have valid player docs and aggregated game stats for historical seasons.
  - Parent-linked seasons in `parentOf` are intentional source-of-truth inputs, even after a team is deactivated.
- Recommendation: opt this aggregation path into `includeInactive` rather than changing `getTeam()` defaults globally.
- Success measures:
  - Historical inactive seasons appear in saved athlete profiles.
  - Saving a profile with only inactive linked seasons no longer throws "No eligible linked seasons were found for this athlete profile."
