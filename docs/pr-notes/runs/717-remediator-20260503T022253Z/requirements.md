# Requirements

## Acceptance Criteria
- Re-import updates an existing roster player only when the imported player has the same external player ID and the existing player's known source type/source ID match the current registration source.
- Existing players with a different known registration source are not overwritten; the import should add the current-source player unless a local-only name/number conflict blocks it.
- Legacy imported players remain supported when they only have `sourceMetadata.externalPlayerId`, `registrationSource.externalPlayerId`, or top-level `externalPlayerId`.
- Roster provenance badges show imported status for both current `sourceMetadata` and legacy import metadata before falling back to `Local-only`.

## Edge Cases
- Duplicate source players with the same external ID in one import are skipped after the first occurrence.
- Missing external IDs or missing names remain skipped.
- Legacy records without source type/source ID cannot be source-disambiguated, so they continue using the prior external-ID fallback for compatibility.
