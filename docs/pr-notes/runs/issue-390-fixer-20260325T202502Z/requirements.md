Objective: close the parent dashboard RSVP regression gap for grouped calendar rows and per-child list cards.

Current state:
- Helper-level child scoping is tested.
- Page-level click behavior is not exercised in automated tests in this branch.
- Repo-standard automated coverage in this checkout is Vitest, not a maintained Playwright flow for this page.

Proposed state:
- Add automated behavioral coverage for the real dashboard RSVP controller logic used by grouped and per-child buttons.
- Keep blast radius low by extracting only the RSVP click/controller logic into a small module and leaving rendering structure intact.

Risk surface and blast radius:
- High user-facing data-integrity risk if wrong child IDs are submitted.
- Medium UI trust risk if local RSVP state or summaries update on the wrong cards.
- Low code blast radius if we isolate changes to one small module, one page import, and tests.

Assumptions:
- This branch's supported CI path is Vitest.
- A controller-level behavioral harness is sufficient evidence here because the page already renders button state from `myRsvp` and `rsvpSummary`.
- Existing submit APIs remain `submitRsvp` for multi-child and `submitRsvpForPlayer` for single-child.

Recommendation:
- Extract the page RSVP submit/update logic into a focused helper module and add targeted Vitest coverage for grouped-row and per-child interactions plus page wiring assertions.

Success measure:
- Automated tests fail without the new controller behavior and pass once wired.
- Grouped submission only sends that row's child IDs.
- Per-child submission only updates the clicked child card locally.
