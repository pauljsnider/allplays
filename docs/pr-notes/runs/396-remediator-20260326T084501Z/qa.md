Validation plan:
- Run the affected Playwright smoke spec covering login and reset-password bootstrap flows.

What would change my mind:
- If the reset-password page legitimately issues a second `accounts:resetPassword` request during load, the fail-closed route would surface it and the test will fail.
- If the smoke environment depends on root-relative paths, the updated URL builder would need adjustment.
