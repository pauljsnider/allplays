Objective: stop live-game video playback from reloading on non-video game document updates in PR #211.

Thinking level: medium
Reason: single-flow regression with user-visible playback loss and a narrow code surface.

Current state:
- `handleGameUpdate()` runs on every `subscribeGame()` snapshot.
- `setupVideoPanel()` always rewrites embedded or recorded media sources.
- Live score, clock, and status updates therefore reload the player and drop viewer position.

Proposed state:
- Preserve the active player instance when the resolved playback mode and source stay the same.
- Continue updating non-source UI state on every game snapshot.
- Only reload the media element when the resolved playback source or mode actually changes.

Risk surface and blast radius:
- Surface: `live-game.js` video panel behavior for live and replay viewers.
- Blast radius: limited to the live game page; no tracker, auth, or Firestore write-path changes.

Assumptions:
- Frequent game snapshots do not intentionally change the stream URL.
- Rewriting `iframe.src` or `video.src` is the direct cause of playback resets.
- Highlight metadata and external-link text can update without forcing a source reset.

Recommendation:
- Add an explicit playback-source change guard and cover it with unit tests.

Acceptance criteria:
- Live score/clock/status snapshots no longer reload the current video when the source is unchanged.
- Source swaps still reload correctly when mode or URL changes.
- Replay highlight/tool UI still updates after game document changes.
