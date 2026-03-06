# Patch Plan
1. Update admin-invite email resolution in `accept-invite.html` to include invite payload fallback.
2. Keep precedence: profile email, then auth email, then invite email.
3. Run quick repository checks relevant to changed file.

# Code Changes Applied
- Patched `processInvite` admin branch in `accept-invite.html`:
  - from `profile?.email || authEmail`
  - to `profile?.email || authEmail || validation?.data?.email`

# Validation Run
- `git diff -- accept-invite.html`
- `node --check js/admin-invite.js`
- `node --check js/auth.js`

# Residual Risks
- If invite records are missing `email`, flow still relies on profile/auth and may fail; this matches existing guardrails.

# Commit Message Draft
Fix admin invite acceptance email fallback
