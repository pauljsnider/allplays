# QA Role Notes

## Validation Scope
- Unit parser correctness on representative TeamSideline HTML.
- Matching behavior for exact/partial team names.
- Empty/missing table behavior.
- New safety checks for large non-table payloads.

## Regression Guardrails
- Keep record format (`w-l` or `w-l-t`) unchanged.
- Preserve fallback table detection by headers.
- Ensure single-quoted id attributes are recognized.

## Acceptance Criteria
- `tests/unit/league-standings.test.js` passes in Vitest.
- No changes required outside standings parser and its tests.
