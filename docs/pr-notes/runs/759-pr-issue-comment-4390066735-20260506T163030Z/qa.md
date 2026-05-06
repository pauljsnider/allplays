## QA Plan

- Add a unit regression where `submittedData` and `player` are empty objects and configured field data exists in a later nested payload source.
- Assert imported field counts, generated profile payload, and preservation of unrelated custom fields.
- Run the focused registration import unit test file and the full unit suite.

## Guardrails

- Empty wrappers must not suppress fallback sources.
- Existing add/update/conflict behavior must remain unchanged.
- Admin-only/private field leakage must not be introduced.
