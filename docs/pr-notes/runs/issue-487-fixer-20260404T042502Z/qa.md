Test strategy:
- Reproduce with persisted opponent snapshot data, not live event accumulation.
- Cover both missing-fouls-column fallback and explicit foul alias mapping.

Primary assertions:
- Rendered markup includes opponent `name`, `number`, and `photoUrl`.
- When configured columns omit fouls, rendered markup still shows `FLS` with the persisted `fouls` value.
- When configured columns use `FOULS` or `FLS`, the renderer maps those labels to `player.fouls` and never prints `0` for a non-zero persisted foul count.

Regression guardrails:
- Do not change generic home lineup column normalization.
- Keep fallback empty-state output for no opponent stats.
