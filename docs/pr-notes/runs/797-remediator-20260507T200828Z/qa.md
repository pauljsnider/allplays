## QA Plan

1. Boundary tests:
   - 500 data rows are accepted.
   - 501 data rows are rejected with a clear error.
   - Header row does not count toward the limit.
2. Regression tests:
   - Valid CSV under the limit still previews and imports.
   - Invalid CSV under the limit still shows existing validation errors.
   - Single matchup flow remains unchanged.
3. Negative tests:
   - 501 valid rows are rejected before preview cards render.
   - 501 invalid rows are rejected by row limit before per-row validation rendering.
   - Uploading an oversized file after a valid file clears the prior preview and disables import.

## Validation Notes

- There is no full browser automation coverage for responsiveness in this static app. Manual validation is required for the browser-hang risk.
