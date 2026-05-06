# Code Plan

## Implementation Plan
1. In `js/edit-roster-registration-import.js`, add helpers to extract known source identity from existing players and build a normalized source/external composite key.
2. Build existing-player lookup maps with source-aware keys first and legacy external-ID fallback second.
3. During planning, use the current source composite key for matching and fall back to legacy external-ID matches only when the existing record has no known source identity.
4. In `edit-roster.html`, add a helper that detects imported players from `sourceMetadata.externalPlayerId`, `registrationSource.externalPlayerId`, or top-level legacy IDs, and use it for the badge.
5. Update focused unit tests for the new matching and badge behavior.

## Scope Control
- No schema migration.
- No broader roster UI refactor.
- No branch changes.
