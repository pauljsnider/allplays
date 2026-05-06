## Architecture Decisions

- Add a local `firstNonEmptyObject(...values)` helper beside `asObject()`.
- Use it only for selecting the aggregate `submitted` and `playerSource` objects in `getRegistrationAnswerSources()`.
- Preserve the existing answer source priority list and existing downstream filtering of empty sources.

## Risk / Blast Radius

- Blast radius is limited to registration roster import planning.
- No Firestore schema, rules, auth, or storage changes.
- Public/private field segregation remains governed by the existing split path.

## Rollback

- Revert the helper and the two selector substitutions in `js/edit-roster-registration-import.js`.
- No migration rollback is required.
