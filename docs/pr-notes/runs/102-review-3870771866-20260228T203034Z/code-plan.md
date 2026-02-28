# Code Role Plan and Result

## Planned Patch
1. Update helper guard from falsy to nullish check.
2. Add regression test asserting `expiresAt: 0` is expired.

## Implemented
- `js/access-code-utils.js`: `if (expiresAt == null) return false;`
- `tests/unit/access-code-utils.test.js`: added `treats zero-millis timestamps as valid expirations` test.

## Out of Scope
- Broader refactor of other expiration call sites.
