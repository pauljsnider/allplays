# Code Plan

## Files
- `.github/workflows/regression-guards.yml`
- `edit-roster.html`

## Changes
1. Add explicit workflow `contents: read` permission for checkout.
2. Defer Firebase AI imports until Bulk AI is opened or used so normal roster page load does not require AI/Firebase vendor modules.

## Risk
Low. Workflow permission is read-only. Product change is scoped to Bulk AI module loading and keeps existing Bulk AI behavior behind the same UI path.
