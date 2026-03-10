Thinking level: medium
Reason: existing CRUD call sites are broad, but the required behavior can be isolated behind pure helpers plus a small db-layer integration.

Plan:
1. Add a new unit-tested helper module for shared schedule mirror metadata and opponent-team payload generation.
2. Fail tests first for:
   - placeholder fixture staying local-only
   - mirrored payload generation for linked opponents
   - score/home-away inversion on mirrored updates
3. Wire helper use into `addGame`, `updateGame`, `deleteGame`, and `cancelGame`.
4. Keep sync best-effort and avoid broad refactors.
