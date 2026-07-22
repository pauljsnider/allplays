# Patch Plan

1. Add a dependency-injected live header verifier and CLI.
2. Verify root, React shell/direct route, stable asset, widget, and runtime config.
3. Enforce common headers, minimum HSTS, restrictive baseline CSP, widget-only permissive framing, and runtime no-store/restrictive policy.
4. Add focused mocked-fetch regression tests.
5. Wire the verifier into post-deploy smoke against the Firebase candidate.

# Code Changes Applied

Planned only at role-analysis time. The main lane owns all edits.

# Validation Run

- Inspect the live candidate response contract.
- Run focused Vitest files for the verifier, Firebase header configuration, and Pages meta bridge.
- Run the verifier against the live candidate origin.

# Residual Risks

- The verifier must not hard-code hashed assets.
- Node fetch may normalize duplicate headers, so static configuration tests remain complementary.
- Runtime config inherits the baseline Permissions-Policy; tightening it is outside this slice.

# Commit Message Draft

`Verify candidate response headers (#4120)`

# Synthesis

## Acceptance Criteria

Use the issue criteria plus a live endpoint matrix and path-specific failure diagnostics.

## Architecture Decisions

Firebase is the selected candidate. Keep `firebase.json` as the only header configuration and add live verification instead of unused `hosting/headers.conf` or `hosting/routes.json` files.

## QA Plan

Test semantic policy checks with mocked responses, retain existing config/meta tests, then run the verifier against the live candidate.

## Implementation Plan

Add the verifier, tests, and post-deploy workflow step only. No app or staging changes.

## Risks And Rollback

The blast radius is limited to a read-only post-deploy gate. Rollback is removal of the workflow step and verifier; deployed application behavior is unchanged.

Root cause: centralized Firebase rules existed, but only source configuration was tested. No post-deploy contract could detect generated-config drift, rule-precedence errors, or candidate-origin header omissions.
