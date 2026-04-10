## Current State
- `index.html` boots the homepage through `initHomepage(...)`.
- `initHomepage` uses `checkAuth(...)` and `applyHeroCta(...)`.
- `applyHeroCta(...)` currently hard-codes `dashboard.html` for any truthy user object.
- `js/auth.js#getRedirectUrl(...)` already owns the correct role precedence.

## Proposed State
- Thread `getRedirectUrl` into `initHomepage(...)`.
- Update `applyHeroCta(...)` to delegate authenticated CTA destination selection to that function, with a safe fallback to `dashboard.html`.
- Keep the change local to homepage composition instead of moving auth or routing rules.

## Why This Shape
- It eliminates policy drift between login redirects and homepage CTA routing.
- It keeps the blast radius narrow: one homepage module, one page entrypoint import, one test file.
- It preserves existing behavior for guests and for any user shape not recognized by role routing.

## Controls
- No new storage, network, or auth side effects.
- No change to role derivation logic itself.
- Existing role precedence remains centralized in `js/auth.js`.
