# Code Role Plan (fallback synthesis)

1. Add failing unit tests for native standings compute/sort behavior.
2. Implement new `js/native-standings.js` pure engine with config-driven ranking/tiebreakers.
3. Update `team.html` to compute native standings from loaded games when enabled, fallback to current external standings fetch.
4. Update `edit-team.html` to persist minimal standings config controls.
5. Run targeted vitest for new tests and existing league standings tests.
