# Code Plan

## Implementation Plan
1. Change public stat storage normalization to use `slugifyStatId` instead of punctuation-preserving normalization.
2. Update the visibility split test expected keys for `AST/TO` and `FG%` to `astto` and `fg`.
3. Add a regression assertion that leaderboard generation resolves punctuated base top stat values from split public stats.
4. Run the focused Vitest file and commit the source, tests, and role notes.
