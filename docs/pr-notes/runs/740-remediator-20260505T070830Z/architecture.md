# Architecture role notes

## Architecture Decisions
- Keep validation in `js/premium-entitlements.js` so all premium gate callers use the same entitlement rules.
- Add an explicit `currentSeasonId` comparison for team scope, defaulting to the current UTC year to match checkout default season creation.
- Tighten Firestore parent access by removing parent reads from raw team entitlement documents. Owner/admin/global admin access remains.

## Risks And Rollback
- Parents may see premium state as unavailable/locked until a sanitized entitlement status document exists. This is safer than exposing billing identifiers.
- Rollback is a small revert of the validator/rules changes if a safer read model is implemented differently.
