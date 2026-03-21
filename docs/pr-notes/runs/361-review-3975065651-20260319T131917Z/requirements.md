Objective: remove the reported navigation-wait race from the new footer smoke coverage without changing the user-visible support-link behavior.

Current state:
- The PR already adds the needed footer support-link smoke coverage and broadens smoke workflow execution to the full suite.
- The homepage help-link assertion waits for navigation and clicks in the same `Promise.all(...)` expression.

Proposed state:
- Register the URL wait handle before clicking the homepage Help Center link so navigation observation is explicit and deterministic.
- Preserve the same assertions on support-link destinations and workflow scope.

Risk surface and blast radius:
- Blast radius is limited to `tests/smoke/footer-support-links.spec.js` and these run notes.
- No production HTML, JS runtime, auth, or workflow behavior changes.

Assumptions:
- `help.html` remains the intended in-app destination for the homepage Help Center footer link.
- The reviewer’s acceptance criterion is removal of the race risk rather than a broader test redesign.

Recommendation:
- Apply the explicit pre-click `waitForURL(...)` registration pattern.
- Leave the rest of the smoke coverage unchanged because it already matches the control objective for issue #356.

Success criteria:
- The homepage smoke test registers the navigation waiter before user interaction.
- Existing footer link expectations remain unchanged.
