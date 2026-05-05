# Architecture

## Decisions
- Use a composite match key of normalized source type, source ID, and external player ID when an existing player has source identity metadata.
- Keep a legacy external-ID-only fallback for existing players that have an external player ID but no source identity fields.
- Keep payload shape unchanged: new imports continue writing `sourceMetadata.sourceType`, `sourceMetadata.sourceId`, and `sourceMetadata.externalPlayerId`.
- Add a small page-local helper for roster badge provenance so UI logic mirrors the import planner's legacy ID recognition.

## Risks And Rollback
- Risk: legacy records without source identity can still collide across providers because there is no reliable stored source to compare. This is accepted for backwards compatibility.
- Rollback: revert the helper changes in `js/edit-roster-registration-import.js` and the badge helper/template change in `edit-roster.html`.
