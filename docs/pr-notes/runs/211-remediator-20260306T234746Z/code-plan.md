Implementation plan:
1. Add a helper that resolves the next playback config without mutating DOM state.
2. Add a gated refresh wrapper that only calls `setupVideoPanel` when a reload is required, unless forced during initial page setup.
3. Replace the unconditional `setupVideoPanel` call inside `handleGameUpdate` with the gated wrapper.
4. Keep the initial page load on a forced setup so the panel still initializes from scratch.
