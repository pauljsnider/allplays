# Requirements role

- Objective: prevent accepted team admins from losing dashboard team visibility when profile email and auth email diverge.
- Current state: `dashboard.html` now loads team access with `user.email || profile?.email`, which preserves the authenticated identity first and falls back only when auth email is absent.
- Proposed state: keep auth email as the primary lookup key because admin invitations are tied to the real sign-in identity seen by the user.
- Risk surface: low. Blast radius is limited to dashboard team discovery for coach/admin users. Reversing precedence could hide teams for valid admins.
- Assumptions:
  - Team admin access is keyed by email.
  - `user.email` is the freshest source when present.
  - `profile.email` can lag some sign-in flows.
- Recommendation: accept the auth-first precedence and update regression coverage to match it.
- Success measure: focused dashboard access regression passes and the branch contains no remaining `profile?.email || user.email` dashboard lookup.
