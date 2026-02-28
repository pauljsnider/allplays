# QA Role Output

## Test Strategy
Add regression tests around parser decoding behavior via public `parseICS()` API.

## Added Coverage
1. `TZID="Custom\\,Zone\\;Region"` decodes and reaches timezone resolution warning with decoded value.
2. `TZID="Custom\\\"Zone"` decodes embedded quote and reaches timezone resolution warning with decoded value.

## Regression Guardrails
- Existing timezone suite remains the main guardrail for TZID + numeric offset + DST behavior.
- Verify no change to event acceptance/drop policy beyond improved parameter decoding.

## Residual Risk
- Parser still does not fully implement every rare ICS parameter grammar variant; scope intentionally limited to review-raised escape cases.
