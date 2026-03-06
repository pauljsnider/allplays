# Code Role Plan

## Plan
1. Update `parseShortOffsetZonePart` validation from permissive hour range to valid UTC offset range.
2. Enforce `±14:00` boundary rule (`14` hours only valid with `00` minutes).
3. Keep all other behavior unchanged.
4. Run `node --check js/utils.js`.
5. Commit only scoped changes for PR review remediation.
