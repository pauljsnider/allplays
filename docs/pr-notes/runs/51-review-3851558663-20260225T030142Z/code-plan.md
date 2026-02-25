# Code Role (allplays-code-expert)

## Objective
Ship a minimal, safe patch addressing review feedback on URL validation.

## Implementation Plan
1. Add shared `isValidHttpUrl()` and `linkifyEscapedText()` helper in `js/drills-issue28-helpers.js`.
2. Replace broad direct regex replacement in both `linkifySafeText()` and `applyInlineMd()` with shared validator-backed linkifier.
3. Add unit tests for malformed URL rejection and trailing punctuation handling.
4. Run targeted helper tests and commit.

## Tradeoffs
- Uses native URL parser for correctness and maintainability.
- Keeps regex candidate matching for performance and readability.
- Does not normalize URL entities (`&amp;`) to avoid broader rendering behavior change in this PR.
