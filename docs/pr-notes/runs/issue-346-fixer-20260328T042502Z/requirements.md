Objective: add automated homepage index coverage for hero CTA state, live/upcoming discovery rails, replay links, and fallback states.

Current state:
- `index.html` owns auth-aware CTA text plus Firestore-backed live/upcoming/replay rendering in one inline module.
- Existing homepage coverage does not exercise dynamic replacement of loading placeholders or partial-failure behavior.

Proposed state:
- Preserve current visitor behavior.
- Add deterministic automated coverage for the homepage discovery workflow with mocked auth/db/utils dependencies.

Risk surface and blast radius:
- Homepage is anonymous-user entry traffic, so a regression affects first-touch conversion and replay discovery.
- Changes should stay local to homepage rendering and test harness only.

Assumptions:
- Existing CTA labels and fallback copy in `index.html` are the intended product copy.
- Deduplication by `game.id` is the desired merge rule for live plus upcoming rails.

Recommendation:
- Extract homepage logic into a small testable module and cover the actual workflow branches through dependency injection.
- This minimizes blast radius while making the current resilience logic enforceable in CI.

Success criteria:
- Automated tests prove loading placeholders are replaced.
- Duplicate live/upcoming entries collapse to one card.
- Replay links retain `replay=true`.
- Partial and full query failures render the expected fallback copy.
