# Requirements role notes

## Acceptance criteria
- Selected streaming volunteers can discover private teams in app search when they match `teamPermissions.streaming.memberIds` by uid.
- Legacy selected stream volunteers can discover private teams in app search when they match `streamVolunteerEmails` by normalized email.
- Ineligible users and signed-out users cannot discover those private teams or their players.
- The redundant `|| []` fallback after an `Array.isArray` guard is removed.
- Tests cover the private-team loading path that would fail when `getTeams()` does not return private stream-volunteer teams.

## Feedback classification
- `PRRT_kwDOQe-T586FG5WQ`: actionable, code cleanup in selected-stream member id handling.
- `PRRT_kwDOQe-T586FG655`: actionable despite informational label, because the current loader can miss private stream-volunteer teams before the access check.
