# QA Role (allplays-qa-expert equivalent fallback)

Requested skills (`allplays-orchestrator-playbook`, `allplays-qa-expert`) and `sessions_spawn` are unavailable in this runtime. This file captures equivalent QA analysis.

## Primary risks
- Notification spam from score writes on unchanged values.
- Unauthorized recipients due to weak membership checks.
- Broken deep links from malformed payload routing.
- Service worker registration failures in unsupported browsers.

## Test strategy
- Unit tests for notification preference normalization and category mapping.
- Unit tests for game-change classification logic (score vs schedule vs none).
- Wiring test(s) to ensure profile settings imports push helpers and DB preference APIs.
- Manual smoke test:
  - Enable permissions and token on device.
  - Enable only one category for a team.
  - Trigger each event type and verify only selected category notifies.
  - Verify click deep-link destination.

## Regression guardrails
- Defaults keep all categories off until user enables.
- Score trigger only fires on actual numeric score changes.
- Schedule trigger restricted to defined fields (`date`, `location`, `status`, `opponent`, `title`).
