# Code plan

- In `js/live-game.js`, add a helper that compares URL strings after browser URL normalization.
- Add a helper that verifies `state.videoPlayback.sourceUrl` is the media-hub replay source.
- Update `canPlayMediaHubHighlight` to require that active replay-source match before enabling Play or seeking replay-relative timestamps.
