Test focus
- Team chat multi-file attachment send failure path.

Checks
- Confirm `team-chat.html` no longer uses parallel `Promise.all(...)` uploads for composer sends.
- Confirm already-uploaded attachments are cleaned up when the send path throws after partial success.
- Run focused unit coverage for:
  - `tests/unit/team-chat-send-media-cleanup.test.js`
  - `tests/unit/team-chat-media.test.js`

Residual risk
- The new regression is a static wiring test, not a browser-level integration test.
- Cleanup remains best-effort if storage deletion itself fails.
