# Architecture analysis

The requested `allplays-architecture-expert` skill was unavailable, so this analysis applies the assigned senior static-web/Firebase architecture role directly.

## Current flow

The smoke spec module-mocks `parentToolsAccessService`, captures submissions in `window.__accessRequests`, and runs the Parent Tools hub at a 390x844 touch viewport. `AccessTool` owns a controlled `selectedPlayerId` initialized to an empty string and disables submission until both team and player IDs exist.

## Root cause

The smoke roster supplied only one player and moved directly from roster load to selection and submission. That topology could not distinguish an intentional choice from an implicit index-zero default and did not assert that loading a roster sent no request.

## Minimal design

Keep the production and Firebase boundaries unchanged. Supply two stable players for `team-2`, assert the controlled chooser remains blank and submission remains disabled, then choose the second player and verify the exact captured team/player pair.

## Risk controls

Use existing accessible labels and the existing capture mock. Await roster loading with Playwright assertions rather than sleeps, and require the second player ID so a first-player fallback fails deterministically.
