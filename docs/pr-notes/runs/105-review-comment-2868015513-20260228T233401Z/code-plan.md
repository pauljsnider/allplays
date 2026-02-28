# Code Role Summary

## Minimal Patch
- File: `js/utils.js`
- Function: `expandRecurrence`
- Change: reorder inclusivity normalization to handle `isUtcMidnight` before `isLocalMidnight`, with explicit comment for date-input source behavior.

## Rationale
The date-picker persistence path emits UTC-midnight timestamps; giving that condition precedence hardens the intended behavior and addresses reviewer concern directly.
