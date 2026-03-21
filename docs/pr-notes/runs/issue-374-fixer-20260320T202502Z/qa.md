Coverage target:
- Real-time status change from scheduled/live into `liveStatus: 'completed'`.
- Wrap-Up form prefill from current game state.
- Final submit payload and redirect target.

Validation plan:
1. Add a focused Vitest file for the new wrap-up helper module.
2. Include page-wiring assertions against `game-day.html` so the page is forced to use the tested helpers.
3. Run the targeted Vitest file.

Guardrails:
- Assert completed transition only prompts when not already in wrap-up.
- Assert wrap-up field values come from current score state and saved post-game notes.
- Assert submit payload includes `status: 'completed'` and `liveStatus: 'completed'` before redirecting to `game.html#teamId=...&gameId=...`.
