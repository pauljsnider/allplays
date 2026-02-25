# Code Role Notes

## Minimal Safe Patch
- File: `game-day.html`
- Function: `hydrateChatState(game)`
- Change: initialize `lastPersistedChatSignature` to remote signature only; otherwise empty string.

## Why Minimal
Single-line logic change in existing state assignment preserves current data flow, timers, and write path while fixing the false dedupe condition.
