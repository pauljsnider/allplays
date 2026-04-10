## Objective
- Add authenticated homepage coverage for role-aware dashboard routing so parents and coaches do not silently share the same CTA destination.

## Current State
- `js/homepage.js` changes the homepage hero CTA for any signed-in user.
- That CTA always points to `dashboard.html`, regardless of whether the signed-in user is a coach or a parent.
- Existing homepage unit coverage asserts only the generic signed-in destination and misses the parent path.

## Proposed State
- The homepage CTA should mirror auth redirect behavior:
  - coaches/admins -> `dashboard.html`
  - parents -> `parent-dashboard.html`
- Automated coverage should exercise both authenticated roles from the homepage entry flow.

## Risk Surface
- Blast radius is limited to homepage CTA wiring and homepage-specific tests.
- No Firestore schema, auth backend, or multi-tenant access rules change.
- Main regression risk is accidentally changing guest CTA behavior or coach routing while fixing parents.

## Assumptions
- `getRedirectUrl(user)` in `js/auth.js` is the canonical role-routing policy.
- A user with both coach/admin and parent attributes should still follow the existing coach/admin precedence.
- The requested subagent skills and `sessions_spawn` tool are unavailable in this environment, so this artifact records the synthesized role output directly.

## Recommendation
- Reuse `getRedirectUrl` for homepage CTA selection rather than duplicating role checks in `js/homepage.js`.
- Add focused homepage tests for parent and coach users, while preserving guest CTA assertions already in place.

## Success Criteria
- Authenticated parent homepage CTA resolves to `parent-dashboard.html`.
- Authenticated coach homepage CTA resolves to `dashboard.html`.
- Existing guest homepage CTA remains `login.html#signup`.
