# QA analysis — issue #5371

## Current coverage

Existing tests cover signed-out destination preservation, separate prepare/confirm clicks, cross-user and expired requests, unsupported actions, stale previews, partial remaining-work retries, ambiguous persistence, and duplicate execution blocking.

## Coverage gap

Component tests cover completed messaging, denial, and in-flight double clicks, but do not assert the rendered terminal status, partial remaining-preview presentation, failed guidance, or executing/uncertain guidance. This permits outcome presentation to drift from the durable state while mutation safety remains intact.

## Focused regressions

1. A resolved completed result renders `Status: completed`, removes confirmation controls, and does not retain `Status: prepared`.
2. A resolved failed result renders `Status: failed`, explicitly avoids a completion claim, and offers no replay.
3. A partial result reloads the revised pending preview and requires a fresh **Confirm remaining changes** action.
4. An initially executing request explains that it may still be running or have an uncertain outcome and offers no mutation control.

Run the page and service Vitest files together, then the app build for strict TypeScript/import validation. The existing Playwright auth smoke remains the focused route-level browser regression.
