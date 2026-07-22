# Risk Matrix

- High: permissive widget framing policy leaks to other paths.
- High: runtime config becomes cacheable or frameable.
- Medium: root, React routes, and assets receive different effective policies.
- Medium: strict string matching rejects valid stronger HSTS.
- Low: the unchanged meta bridge regresses; existing staging tests cover it.

# Automated Tests To Add/Update

- Add focused unit tests for successful baseline/widget/runtime responses.
- Add failures for missing common headers, weak HSTS, permissive CSP leakage, incorrect widget CSP, and cacheable/frameable runtime config.
- Keep existing hosting configuration and Pages meta-bridge tests as adjacent coverage.

# Manual Test Plan

- Run the new verifier against `https://game-flow-c6311.web.app`.
- Confirm representative root, React, asset, widget, and runtime-config paths pass.
- Confirm canonical DNS and the existing Pages meta bridge remain unchanged.

# Negative Tests

- Missing required headers or non-200 responses.
- `frame-ancestors *` on non-widget paths.
- Restrictive `frame-ancestors` on the widget.
- Runtime config without no-store, non-frameable CSP, or no-referrer.

# Release Gates

- Focused verifier, hosting-security-header, and Pages staging unit tests pass.
- Live candidate verification passes.
- Diff contains no DNS, App Check, scoreboard behavior, or meta-bridge changes.

# Post-Deploy Checks

- Run the candidate verifier after successful deployment.
- Record path-specific failure output in the post-deploy workflow.
- Continue canonical browser smoke independently against `allplays.ai`.
