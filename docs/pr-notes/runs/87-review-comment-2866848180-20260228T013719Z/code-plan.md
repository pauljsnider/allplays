# Code Role Notes

## Implementation
- Added team-level cache container for RSVP hydration inputs.
- Replaced direct roster read in `computeRsvpSummary` with cached roster promise.
- Added cached resolver for fallback user->player IDs and plugged into existing fallback builder.
- Preserved output schema and existing exception semantics.

## Why Minimal/Safe
- No caller contract changes.
- No UI file changes required.
- Failures clear cache entries to avoid sticky errors.
