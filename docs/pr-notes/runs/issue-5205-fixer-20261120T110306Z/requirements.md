# Requirements role

The requested `allplays-requirements-expert` skill was unavailable, and the required read-only role session failed before execution because the runtime reported `published reply runtime missing for main`. This main-lane synthesis applies the requested UX, coach, parent, and sports-manager perspectives.

- A manager must be able to re-invite the same parent after an earlier invitation expires or is revoked.
- Repeating an import while an invite is active must reuse the active code and avoid duplicate invitations.
- Repeating an already completed operation must continue to replay the completed outcome.
- Renewal must still pass authorization and rate limits, and must create a fresh code rather than revive a terminal code.
- The fix should not require a manager to modify the roster contact or use a different email spelling.

The preferred behavior is to treat expired and revoked invitation outcomes as renewable terminal states at the server boundary. This keeps the legacy roster flow reliable and makes the behavior consistent for other authorized callers.
