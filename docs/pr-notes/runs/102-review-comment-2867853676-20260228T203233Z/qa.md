# QA Role Summary

## Regression focus
- Boundary timestamp equality (`nowMs === expiresAt`) should expire.
- Zero timestamp (`expiresAt: 0`) should expire.
- Missing timestamp should remain valid unless other checks fail.

## Evidence strategy
- Run `tests/unit/access-code-utils.test.js` which includes zero-millis and boundary assertions.
- Verify no test regressions in helper behavior after caller refactor.
