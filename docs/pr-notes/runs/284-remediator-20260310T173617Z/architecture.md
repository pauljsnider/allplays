Decision: keep the fix at the call site in `dashboard.html`.

Why this path:
- Blast radius stays limited to the page called out in review.
- `getUserTeamsWithAccess` is a generic helper and should not guess between multiple possible email sources.
- The dashboard already enriches the auth user with profile data, so the precedence decision belongs there.

Risk surface:
- Low. Only admin-team lookup email selection changes.
- Rollback is one-line reversion if unexpected access regressions appear.

Controls:
- Auth email remains the primary identity source.
- Profile email stays available as fallback for accounts missing auth email.
