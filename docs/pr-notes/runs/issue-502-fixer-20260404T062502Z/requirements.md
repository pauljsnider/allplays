Objective: Protect the invite redemption login flow for existing parent/admin users.

Current state:
- Unit coverage proves helper-level invite redirect behavior.
- Browser coverage does not exercise the real `login.html` handlers with invite query params.

Proposed state:
- Add browser coverage for email/password login and Google login redirect paths when `?code` and `?type` are present.

Risk surface and blast radius:
- A regression strands invited existing users after successful authentication.
- Blast radius is limited to invite-based login entry points, but the user-facing failure is immediate.

Assumptions:
- Existing users may arrive on invite links containing `type=parent` or `type=admin`.
- The current repo-standard browser coverage lives under `tests/smoke`.

Recommendation:
- Add browser tests around the real page wiring and only patch app code if the test exposes a redirect break.
