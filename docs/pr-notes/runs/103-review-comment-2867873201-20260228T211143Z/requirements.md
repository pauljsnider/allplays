# Requirements Role Notes

## Objective
Address PR #103 review feedback about `GMT([+-])(\d{1,2})(?::?(\d{2}))?` accepting non-zero-padded hours.

## User Impact
- Parents/coaches importing ICS schedules should get consistent event times across browsers.
- Offset parsing must avoid assumptions that can drift by runtime locale behavior.

## Acceptance Criteria
- Parser only accepts canonical `GMT±HH` or `GMT±HH:MM` for `shortOffset` path.
- Non-canonical forms (e.g., `GMT-5`) do not break import; parser falls back to component-diff path.
- Existing valid TZID imports continue producing expected UTC instants.
- Unit tests cover the non-zero-padded offset fallback behavior.

## Risk Surface / Blast Radius
- Scope limited to ICS timezone parse internals in `js/utils.js`.
- No UI, schema, or network behavior changes.
