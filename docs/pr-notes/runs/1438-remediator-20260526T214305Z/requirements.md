# Requirements

- Prevent duplicate fee recipient documents returned by overlapping Firestore queries from producing duplicate or nondeterministic TeamFee entries.
- Load parent-assigned fee recipients generated from roster assignments, including records with `teamId`/`playerId` or `playerKey` but no direct user-id fields.
- Keep fallback behavior for accounts without parent link metadata so directly keyed recipient records still load.
