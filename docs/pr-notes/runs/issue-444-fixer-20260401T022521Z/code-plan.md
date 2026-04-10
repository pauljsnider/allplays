Implementation plan
1. Add a small helper module for period lists and active-period normalization.
2. Add a failing regression that covers publish payload round-trip and visible-period restoration.
3. Wire `game-day.html` to use the helper when rendering Game Day period tabs.
4. Run the affected unit tests, then the full unit suite if practical.
5. Stage and commit with issue linkage.

Assumptions
- Vitest is the canonical automated path for this repo’s newer tests.
- A unit-level round-trip test is acceptable evidence for the requested save/reload coverage in this repository.
