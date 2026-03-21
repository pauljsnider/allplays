Current state: `init()` exits directly into `startReplay()` when `replay=true`; `updateChatAvailability()` is skipped unless later reached through other live-game update paths.

Proposed state: `startReplay()` should establish replay chat availability up front so both the empty-events early return and the populated replay path inherit the same control state.

Controls:
- Keep the fix inside replay startup only.
- Do not change `isViewerChatEnabled()` or live-game subscription behavior.
- Verify the DOM state (`#chat-input`, `#chat-locked-notice`, replay controls, score display) from module init rather than helper-only tests.
