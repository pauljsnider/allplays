# Architecture notes

Acceptance criteria: preview smoke team schedule calendar tests must boot `team.html` with routed module stubs and render team header/schedule content before assertions.

Root cause: `team.html` now imports `./js/team-pass.js?v=1`. The smoke test routes core dependencies but not this new module. The real module imports `auth` from Firebase, while the smoke `firebase.js?v=11` stub does not export `auth`, so the browser module graph fails before `loadTeam()` renders the header and schedule.

Decision: keep production code unchanged. Add a smoke-test-only route stub for `team-pass.js?v=1` with `renderTeamPassCard()` so the page can boot under the existing mocked Firebase surface.

Risk and rollback: low blast radius, test-only change. Rollback by removing the route and stub if production module loading behavior changes.
