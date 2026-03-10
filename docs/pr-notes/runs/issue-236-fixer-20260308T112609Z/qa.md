Focus:
- Regression coverage for placeholder tournament scheduling remaining single-team.
- Regression coverage for mirrored linked fixtures creating the correct opponent payload.
- Regression coverage for updates swapping home/away score perspective.
- Regression coverage for unlinking removing counterpart sync metadata.

Manual spot checks after unit tests:
1. Create tournament game with text opponent like `Winner SF1`; verify it saves without linked-team metadata.
2. Edit same game and link a real opponent team; verify opponent team receives mirrored fixture.
3. Finalize score on one team; verify mirrored opponent game shows swapped score totals.
4. Remove linked opponent from one side; verify mirrored counterpart is deleted or detached.

Residual risk:
- Historical linked fixtures created before this patch may not gain counterpart docs until they are edited again.
- Live tracker-only fields intentionally do not mirror.
