# Requirements Analysis

- Scope: Address unresolved PR review threads for `expandRecurringICSEvent` in `js/utils.js` only.
- Must fix constant access order so no pre-definition reads occur at runtime.
- Must preserve local wall-clock time across DST transitions for recurring event expansion.
- Must not re-add base event when recurrence expansion produces zero occurrences due to EXDATE.
- Must avoid truncating valid weekly COUNT recurrences because of fixed-year hard cap.
- Keep blast radius low: no unrelated refactors.
