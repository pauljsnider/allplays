Objective: address PR thread PRRT_kwDOQe-T585zYAhF with the smallest safe code change.

Current state: dashboard team lookup passes `profile?.email || user.email` into `getUserTeamsWithAccess`.
Proposed state: prefer authenticated email and only fall back to profile email when auth email is unavailable.

Evidence:
- `dashboard.html` currently sets `user.profileEmail = profile.email` but only copies it to `user.email` when auth email is missing.
- `js/auth.js` only writes `profile.email` during selected flows, so existing accounts can retain older profile emails.
- `js/db.js#getUserTeamsWithAccess` queries `adminEmails` with the provided email value.

Assumptions:
- The review thread is limited to the dashboard team query path.
- No broader auth normalization change is required for this PR.

Recommendation: change the dashboard call to `user.email || profile?.email` and leave the rest of the flow untouched.

Validation: confirm the diff only changes the email precedence and note that this repo relies on manual testing.
