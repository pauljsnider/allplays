# Requirements

## Acceptance Criteria
- Reopening a game must preserve the actual on-field lineup using stable player IDs, not display-name matching.
- Substitution OUT and IN dropdowns must reflect the true current lineup after prior substitutions.
- Follow-up substitutions must resolve the outgoing player's current position from the merged live lineup.
- Existing saved games that only have legacy name-based substitution entries must continue to load.

## Risks
- Duplicate display names can map substitutions to the wrong roster player if name lookup remains in the live-path.
- Name edits between save and reload can break substitution replay if IDs are not stored.

## Assumptions
- `rotationActual` is only consumed in `game-day.html` and can safely store additive `outId`/`inId` fields.
- Backward compatibility is required for older records that already persist names only.

## Recommendation
- Persist `outId` and `inId` with each substitution while retaining the existing name fields for display/history.
- Resolve on-field substitutions by stored player ID first, then fall back to legacy name matching for older data.
