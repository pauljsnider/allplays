# Patch Scope
Minimal patch in `athlete-profile-builder.html` plus a small wiring assertion update in `tests/unit/athlete-profile-wiring.test.js`.

# Implementation Plan
1. Add a helper to revoke only `blob:` preview URLs.
2. Revoke the current headshot preview before replace, reset, and profile-state hydrate.
3. Revoke clip preview URLs when a clip row is removed.
4. Revoke all clip preview URLs before clearing and rebuilding the clip list during hydrate.
5. Extend wiring coverage to assert preview cleanup hooks are present.

# Edge Cases
- Persisted Firebase Storage URLs must remain usable after save and hydrate.
- Linked season photos must keep rendering when no custom upload is pending.
- External clip links must not be passed to `URL.revokeObjectURL`.
- Empty clip list placeholder behavior must remain intact after removals.

# Suggested Validation
- Run unit suite: `npm exec --yes vitest run tests/unit`
- Manual browser pass on `athlete-profile-builder.html` for headshot replace/reset and clip remove/reload flows.