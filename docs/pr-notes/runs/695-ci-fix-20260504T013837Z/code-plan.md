# Code Plan

## Root Cause
`loadGame(game)` declared `const isReadOnlyGame` twice in the same function scope. The browser script and the unit-test harness both treat that as a syntax error, which caused all tests in `game-plan-switching.test.js` to fail before assertions ran.

## Implementation Plan
- Remove the second duplicate `const isReadOnlyGame` declaration.
- Reuse the first value for both read-only status messaging and save button state.
- Validate with the affected test and full unit suite.
