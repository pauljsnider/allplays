# Requirements

- Preserve configured roster fields when teams carry multiple schema keys during migration.
- `getRosterFieldDefinitions()` must not select an empty candidate array when a later candidate array contains definitions.
- Existing visibility/privacy filtering behavior must remain unchanged.
- Scope is limited to `js/roster-field-privacy.js` and targeted unit coverage.

## Acceptance Criteria

1. A team with `rosterFields: []` and populated `rosterProfileFields` returns the fallback definitions.
2. A team with no populated candidate arrays returns an empty definition list.
3. Existing public/team/admin visibility behavior remains intact.
