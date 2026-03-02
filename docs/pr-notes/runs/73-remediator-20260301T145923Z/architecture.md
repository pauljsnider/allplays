# Architecture role notes
- `finalizeParentInviteSignup` should treat invite redemption as a committed side effect boundary.
- If post-redemption steps fail, preferred behavior is: try invite rollback function (if available), and avoid deleting auth user when invite remains consumed.
- Redirect auth flow should perform cleanup at the outer boundary so all throw paths, including `getRedirectResult` failures, clear transient session state.
