# Architecture Notes

## Root cause
The preview smoke test replaces `js/db.js?v=76` with a route-level stub for `edit-team.html`, but the stub did not export `getUserProfile`. The production page imports `getUserProfile` during module linking, so the browser rejected the module before the edit-team script could initialize or attach the admin invite handlers. The visible CI symptom was `#admin-invite-status` staying empty after clicking `#save-admin-btn`.

## Minimal fix
Add a no-op `getUserProfile()` export to the edit-team DB smoke stub. No production code change is needed because the failure is in test scaffolding drift against the page's named imports.

## Risk and rollback
Risk is isolated to the smoke test harness. Rollback is reverting the single stub export if the page import contract changes again.
