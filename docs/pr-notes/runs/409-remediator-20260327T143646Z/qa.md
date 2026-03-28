Risk focus:
- Seeking to a point after a mid-session reset must show only post-reset state and plays.
- Normal replay playback and live event processing should remain unchanged.

Manual validation plan:
1. Open the replay test page or live game replay view.
2. Use a dataset with a reset event and pre-reset plays that share or precede the reset target window.
3. Seek to a time after the reset and verify the scoreboard, stats, lineup, and play feed reflect only post-reset events.
4. Seek before the reset and verify pre-reset events still appear as expected.

Residual risk:
- There is no automated coverage in this repo, so validation depends on targeted manual replay testing.
