# Architecture notes

## Acceptance criteria
- The edit-config platform admin smoke test must have exactly one `#team-name-display` element, matching the production page contract.
- The team admin banner stub should not introduce production-inaccurate duplicate IDs.

## Architecture decision
- Keep production code unchanged. `edit-config.html` owns `#team-name-display` for the stat configuration header, while the real `js/team-admin-banner.js` renders team context without that ID.
- Fix the smoke stub to use a test-specific selector for its banner team name.

## Risks and rollback
- Risk is low and isolated to one smoke spec stub.
- Rollback is reverting the single stub selector change if a broader banner contract is introduced later.
