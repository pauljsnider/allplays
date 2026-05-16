# Architecture

- The server-authoritative Firestore rule must remain the source of truth for direct writes.
- Since `playerTeamIds` has no writer, keeping it in either client or rules creates a broken policy branch and misleading UI copy.
- Minimal safe remediation is to remove that unsupported branch rather than broadening rules to all signed-in users.
- Future roster-member self-assignment should add a populated, rules-verifiable membership index before reintroducing roster-member language.

## Risks And Rollback
- Scope narrows the advertised policy to actually enforceable roles. Rollback is reverting this commit if a populated roster-member identity field is later added.
