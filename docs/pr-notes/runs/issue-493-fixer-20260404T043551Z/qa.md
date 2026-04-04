# QA Role Notes

## Coverage Gap
- No test currently proves that modal child-picker changes update the rendered rideshare action state for the selected sibling.

## Test Strategy
- Add a unit test around extracted modal action-state logic:
  - Child A selected with no request -> `Request Spot`, no status copy.
  - Child B selected with existing parent request -> no `Request Spot`, `Cancel` visible, status copy references Child B.
- Keep the existing request-handler payload test and strengthen it only if needed.
- Add a wiring assertion that the dashboard HTML uses the extracted action-state helper.

## Regression Guardrails
- Preserve behavior for requestable vs non-requestable states based on `findRequestForChild` and `canRequestRide`.
- Ensure the selected child name used in status copy matches the child that drove the action state.

## Validation
- Run focused vitest coverage for rideshare controls/wiring.
