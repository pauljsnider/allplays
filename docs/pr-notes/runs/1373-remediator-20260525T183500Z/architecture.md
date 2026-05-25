# Architecture

## Decision
Use one canonical key format for stored player stat values that are consumed by leaderboard definitions: `slugifyStatId`.

## Rationale
`normalizeDefinition` produces slugified IDs for base and provided definitions. `resolveDefinitionValue` reads base stat values by `stats[definition.id]`. Public stat storage must therefore use the same slugified ID format or base top stats with punctuation are not readable.

## Risk And Rollback
- Blast radius is limited to stat key normalization during visibility splitting.
- Private stat isolation is unchanged because private detection already uses slugified keys.
- Rollback is a single helper/expectation revert if a caller requires punctuation-preserving public keys, but that conflicts with current leaderboard definition lookup.
