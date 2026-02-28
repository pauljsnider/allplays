# Code Role Notes

## Patch Scope
- `js/utils.js`
  - Add cached `supportsShortOffsetTimeZoneName()` probe.
  - Gate `shortOffset` formatter path behind probe.
  - Preserve wall-clock fallback behavior.
- `tests/unit/ics-timezone-parse.test.js`
  - Add test for unsupported runtime throwing `RangeError` on `shortOffset`.

## Conflict Resolution
- Requirements and QA both prioritize old-browser safety.
- Architecture prioritizes minimal blast radius.
- Final patch follows all three: internal helper-only change + focused test extension.

## Rollback Plan
Revert commit if parsing regressions appear; prior fallback logic remains known-good baseline.
