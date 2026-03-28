Risk focus:
- Malicious team or opponent names must render as inert text, not executable HTML.
- Malicious `teamId` or `game.id` values must not break out of the generated `href`.
- Existing live/upcoming/replay homepage rendering should still work for normal inputs.

Validation plan:
1. Run the homepage unit test file.
2. Assert normal live and replay links still render.
3. Add hostile input coverage for names, image URLs, and IDs, then verify the rendered HTML contains escaped content and encoded query parameters.

Residual risk:
- The homepage still uses `innerHTML`, so future interpolations in this module must use the same helpers consistently.
- No browser-level manual test is included in this remediation run.
