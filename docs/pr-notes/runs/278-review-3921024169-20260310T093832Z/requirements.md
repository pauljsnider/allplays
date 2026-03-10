Objective: preserve explicit `None` stat-config choices in schedule flows while keeping safe defaults for new games.

Current state:
- `edit-schedule.html` rewrites a blank `#statConfig` value to `resolvePreferredStatConfigId(...)` during submit and calendar-track actions.
- Editing a game with `statTrackerConfigId: null` or choosing `None` cannot persist `null`.

Proposed state:
- Use the raw select value during save/track actions.
- Keep default suggestion behavior at config-load time only, where new unsaved forms can still preselect a preferred config.

Risk surface and blast radius:
- Affects schedule create/edit and calendar-track entry points.
- Low blast radius because downstream pages already handle `statTrackerConfigId: null` after this PR's broader fallback work.

Assumptions:
- The `None` option is intentional product behavior, not an accidental placeholder.
- `loadConfigs()` still runs before normal user submission, so new-game defaults remain available without submit-time fallback.

Recommendation:
- Preserve explicit blank selections and avoid hidden mutation at submit time.

Success measure:
- Editing a null-config game keeps `statTrackerConfigId: null`.
- Choosing `None` before saving or tracking a calendar event persists `null`.
- Existing preferred-config defaults still appear for untouched new-game forms.
