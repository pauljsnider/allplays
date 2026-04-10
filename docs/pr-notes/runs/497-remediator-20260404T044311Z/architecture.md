# Architecture

- Current state: tests build AsyncFunction source by string-replacing ESM imports in js/live-game.js.
- Proposed state: replay-init import rewrite is updated to match the current state import or generalized to avoid future breakage from named import list changes.
- Blast radius: test-only transformation path; production module code should remain untouched unless needed for parity.
