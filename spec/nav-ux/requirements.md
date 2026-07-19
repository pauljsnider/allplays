# Primary Navigation UX Requirements

Issue: #4061

## Scope

This pass covers the signed-in destinations that follow Home: Schedule, Messages, My Teams, Profile, Discover, and Family. It also covers the shared mobile navigation that exposes those destinations.

## User requirements

### Mobile navigation

- Show no more than five persistent bottom-navigation items.
- Keep Home, Schedule, Messages, and My Teams directly available.
- Provide a fifth More destination that exposes Profile, Family, and Discover in one additional tap.
- Indicate when More contains the active route, including nested Profile, Family, and Discover routes.
- Dismiss More after navigation, on route change, Escape, backdrop interaction, and native back.
- Do not change signed-out navigation or signed-in desktop navigation.

### Screen behavior

- Use the main landmark supplied by `AppShell`; destination components must not nest another `main` landmark.
- Make URL-driven Family navigation real links with current-page state.
- Give Discover's view switch tab semantics and associate it with the visible panel.
- Give Messages an announced, retryable error state.
- Give empty Messages and Discover states direct next actions.
- Keep frequent controls touched in this pass at least 44px high or wide.
- Preserve data loading, permissions, route URLs, role behavior, and public access.

## Acceptance criteria

- Signed-in mobile primary navigation has exactly five items.
- More exposes Profile, Family, and Discover with accessible dialog semantics.
- More is visually active for all three destination families.
- Profile renders no nested `main` landmark.
- Discover exposes `tablist`, `tab`, and `tabpanel` semantics.
- Messages errors use `role="alert"` and include Retry.
- Empty Messages includes Create team and Browse teams actions.
- Empty Discover includes Clear filters and the appropriate post/sign-in action.
- Family links expose `aria-current="page"`.
- Updated high-frequency controls meet the 44px target.
- Focused unit tests, smoke tests, production build, and PR CI pass.
