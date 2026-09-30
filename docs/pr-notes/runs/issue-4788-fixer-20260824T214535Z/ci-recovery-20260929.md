# Public-team browser smoke recovery

Target: AllPlays PR #4805. Base: `b7d5375fdadc351a3b6e777282be2299d1c700a4`.
Original head: `2ea589c4684c1aba2f8143f7aae9fea565c706fb`.

The PR adds a `getPublicTeamStandings` import to the public detail route, but
the browser mock for `publicTeamsService.ts` omitted that export. CI run
36485771185 then timed out waiting for the Atlanta Fire heading after public
team navigation. This is a test module contract failure, not evidence of a
transient browser failure.

The unchanged focused browser command failed on the original head and passed
on the exact base with the same installed lockfiles and local Vite server:

```sh
SMOKE_APP_BASE_URL=http://127.0.0.1:5186 npm run test:smoke -- \
  tests/smoke/app-teams.spec.js --grep 'browse teams paginates searched results' \
  --project smoke --workers 1 --reporter=line
```

Repair scope is limited to the browser stub, its navigation assertions, and a
unit contract checking that the stub exports every service function consumed
by the public detail route. Repository-wide smoke search found one route stub
for this service. The new unit contract failed before the stub repair with
`missing named service export getPublicTeamStandings`. It passes afterward.
The browser flow now asserts that the requested team's standings were loaded
and that the explicit empty standings state is visible. Page errors are checked
before the heading assertion throughout the bounded navigation wait.

Validation after the repair:

- Unit contract: 1 passed.
- Original focused browser flow: 1 passed.
- `npm run test:app -- src/pages/PublicTeamDetail.test.tsx`: 13 passed.
- `npm run app:build`: passed, including TypeScript, artifact validation, and
  the cold-start bundle budget.

No production source, dependency, workflow, or CI containment guard changes are
part of this repair. Publishing a new tested commit lets the existing controller
evaluate a new head without resetting the old head's retry ledger. The external
claim is temporary operator ownership and is removed at controller handoff.
