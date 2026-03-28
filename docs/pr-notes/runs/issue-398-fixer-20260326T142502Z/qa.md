Coverage target:
- Late-join viewer seeded from persisted `liveLineup`.
- Viewer update from lineup/substitution payload containing `onCourt` and `bench`.

Test assertions:
- On-court cards only render valid roster players from the provided lineup.
- Bench cards follow the provided bench array after filtering unknown ids and duplicates.
- Bench does not silently expand to every non-on-court player when explicit bench is present.
- Configured stat columns appear on lineup cards for both sections.

Regression guardrails:
- Keep existing reset/state helper tests passing.
- Run the new lineup sync test file plus adjacent live-game and live-tracker unit suites.

Residual risk:
- Full browser wiring is still covered indirectly, not by an integration harness.
- Ordering remains roster-based, which matches current UI behavior.
