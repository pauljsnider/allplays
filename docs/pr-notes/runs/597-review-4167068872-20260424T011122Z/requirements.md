# Requirements

## Objective
Prevent tournament pool ranking overrides from overwriting or clearing other pools when their names normalize to the same legacy slug.

## User Outcome
Admins can save and clear final rankings for similarly named pools, for example `Pool A`, `Pool-A`, and `Pool/A`, without corrupting another pool's standings.

## Acceptance Criteria
- Distinct pool names produce distinct override storage keys.
- Saving an override only updates entries for the exact pool name.
- Clearing an override only removes entries for the exact pool name.
- Existing override data remains readable when the stored record's `poolName` matches the requested pool exactly.

## Risks
Legacy data created under the colliding slug scheme cannot be perfectly untangled if two different pools were already written to the same key. Chosen direction: make new writes collision-safe and preserve exact-name legacy reads/clears where the stored `poolName` still distinguishes the pool.