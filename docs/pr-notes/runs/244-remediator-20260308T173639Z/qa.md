Test focus:
- Anonymous read of a public athlete profile still succeeds.
- Non-owner read of a private athlete profile now returns `null`.
- Owner read of a private athlete profile still works when authenticated.
- Saving an athlete profile ignores stale season keys and only builds summaries from allowed links.

Validation plan:
- Run the existing unit tests covering athlete-profile helpers and wiring.
- Spot-check the source diff for the explicit read authorization gate and stale-key skip path.

Residual risk:
- No integration harness exists here for live Firebase auth/rules interaction, so verification remains unit/source-level.
