# Requirements

## Acceptance Criteria
- CSV export preserves valid falsy selected field values, including `0` and `false`.
- Only `null` and `undefined` are serialized as blank CSV cells.
- Existing escaping and formula-neutralization behavior remains unchanged.

## Actionable Feedback
- Thread PRRT_kwDOQe-T586EyMjJ is actionable. Replace `|| ''` fallback in `buildRegistrationReviewCsv` with a nullish fallback and add regression coverage.
