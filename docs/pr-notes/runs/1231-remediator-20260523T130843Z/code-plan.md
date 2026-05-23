# Code Plan

## Implementation Plan
1. Update `escapeCsvValue` to derive a sanitized value from the raw string.
2. Prefix a single quote when the raw value starts with a formula marker or contains a pipe followed by a formula marker.
3. Preserve the existing CSV quote escaping behavior by running quote/comma/newline escaping after sanitization.
4. Add focused unit coverage in `tests/unit/team-fees-admin.test.js`.

## Risks And Rollback
- Risk: Amount-like negative values in CSV now receive a leading quote because spreadsheet formula hardening treats `-` as dangerous. This matches reviewer guidance.
- Rollback: Revert helper and test changes.
