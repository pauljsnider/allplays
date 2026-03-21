Objective: strengthen the browser-level contract around Help Center navigation without changing production code.

Current state:
- Static footer HTML links to `help.html` from the homepage and shared footer helper.
- CI smoke now runs the full smoke suite, so this spec is the right guardrail boundary.

Proposed state:
- `page.waitForNavigation({ url: '**/help.html' })` becomes the authoritative navigation observer for the homepage click.
- The returned main-document response is asserted as successful.
- A Help Center heading assertion confirms the destination page rendered expected content after navigation.

Blast radius comparison:
- Before: broken `help.html` could pass if the browser still landed on `/help.html`.
- After: the same regression fails in smoke because response success and page render are both required.

Controls equivalence:
- Stronger than the prior URL-only check.
- No new runtime dependencies, no application logic changes, no backend interaction.

Rollback:
- Revert the single smoke-spec patch if it proves too brittle.
- The fallback would be a looser response or content assertion, but current evidence supports the stricter guard.
