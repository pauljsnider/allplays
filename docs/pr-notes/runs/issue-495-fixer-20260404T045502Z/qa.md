QA focus:
- Reproduce the bug at the prompt-construction layer.
- Guard against regressions for soccer and basketball.

Unit coverage to add:
- `buildPracticeFeedPrompt()` uses basketball wording when sport resolves to basketball.
- `buildPracticeFeedPrompt()` uses soccer wording when sport resolves to soccer.
- `buildGameSummaryPrompt()` uses basketball wording and does not mention soccer for basketball context.
- `buildGameSummaryPrompt()` uses soccer wording for soccer context.

Manual validation targets:
1. Open `game-day.html` for a basketball team with a completed game.
2. Run `Generate Practice Feed` and confirm saved guidance is basketball-framed.
3. Run `Generate Game Summary` and confirm saved summary is basketball-framed.
4. Repeat on a soccer team to confirm no behavior regression.

Residual risk:
- If sport metadata is missing in legacy teams, prompts will use a generic youth sports fallback instead of sport-specific wording.
