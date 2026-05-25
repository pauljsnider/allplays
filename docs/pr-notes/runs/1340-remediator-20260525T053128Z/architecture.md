# Architecture

- Keep result eligibility centralized in `js/admin-game-results.js`.
- Treat `status === completed` as explicit completion intent.
- Treat numeric scores as an implicit result only when at least one side is non-zero, because schedule creation defaults new events to `homeScore: 0` and `awayScore: 0`.
- No data model or dashboard wiring changes are required.
