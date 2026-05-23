# Architecture

## Decision
Centralize CSV formula-injection mitigation in `escapeCsvValue()` in `js/team-fees-admin.js`. This keeps the blast radius small and protects all current and future payment-summary fields that use the serializer.

## Scope
- Update `escapeCsvValue()` only for sanitization behavior.
- Add focused unit coverage for direct formula markers, whitespace bypasses, pipe markers, and existing escaping regression cases.

## Impacts
- No persisted data changes.
- No Firebase rules, schema, routing, permissions, or UI changes.
- Exported formula-like values gain a leading apostrophe before normal CSV escaping.

## Risks and rollback
False positives on legitimate leading `-` or `|` text are acceptable for spreadsheet safety. Rollback is a single helper/test revert with no data cleanup.
