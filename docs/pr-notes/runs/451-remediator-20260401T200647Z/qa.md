Thinking level: low, because the change is localized and the existing helper already carries the substantive validation logic.

Primary regression to verify:
1. The dashboard redeem button no longer requires `validateAccessCode(code)` before calling `redeemParentInvite(user.uid, code)`.

Risk checks:
1. Invalid, used, or expired codes should still fail because `redeemParentInvite()` enforces those conditions.
2. Success path should still show the same success alert and reload behavior.
3. Error path should still restore the button state and surface the thrown message.

Validation plan:
1. Update the focused source-level unit test for `parent-dashboard.html`.
2. Run the targeted Vitest file for dashboard redeem wiring.
