# Architecture Notes

## Architecture Decisions
- Keep the defensive guard at the module boundary/helper level instead of adding caller-specific handling. This limits blast radius and preserves existing data mapping behavior.
- Return `[]` for missing or malformed attraction/sponsor collections, matching existing normalizer semantics for undefined inputs.

## Risks And Rollback
- Risk is low: no Firebase schema, auth, or tenant access changes.
- Rollback is a single commit revert if downstream UI expected an exception, which would be undesirable and currently untested behavior.
