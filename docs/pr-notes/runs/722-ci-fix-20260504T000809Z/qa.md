# QA Note

## Failure Mode
The visible assertion for `#roster-image-preview` is downstream of a module import failure. The preview is hidden because the image input `change` listener never registers.

## Validation Plan
1. Run the affected smoke spec only:
   - `npx playwright test -c playwright.smoke.config.js tests/smoke/edit-roster-bulk-ai-reset.spec.js --workers=1`
2. Verify both cases pass:
   - Cancel clears stale uploaded image state.
   - A fresh run after cancel sends only the newly entered text input.

## Coverage
The affected smoke tests directly cover the regression: dependency stubs must allow the page to boot, then image preview, cancel reset, and second-run prompt composition must behave correctly.
