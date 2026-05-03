# QA Plan

Automated:
- Add a targeted unit test for `rosterFields: []` plus populated `rosterProfileFields`.
- Run `npm test -- --run tests/unit/roster-field-privacy.test.js`.

Manual sanity:
- On `team.html` and `player.html`, confirm migrated teams with empty `rosterFields` still display allowed roster fields from fallback definitions.
