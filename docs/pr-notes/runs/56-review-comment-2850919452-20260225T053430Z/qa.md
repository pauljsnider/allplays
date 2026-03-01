# QA Role Notes

## Regression Risks
- Dropdown change handler signature changed; verify all call sites.
- Ensure non-modal rendering (`includeChildPicker=false`) remains unchanged.

## Manual Checks
1. Multi-child parent in modal: switch child, verify Request/Cancel and status text update.
2. Submit request for selected child, refresh, verify persisted request shown for same child.
3. Single-child parent path still shows correct controls.

## Acceptance Criteria
- Eligibility state follows selected child across rerenders.
- No console errors from `setRideChildSelection` invocation.
