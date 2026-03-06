# QA role (fallback synthesis)

## Primary regression to guard
Coach per-player override must not remove sibling availability from parent multi-player RSVP.

## Automated tests
1. Add unit coverage for legacy cleanup predicate:
   - Do not delete multi-player parent docs when overriding one child.
   - Delete single-player legacy docs for same player.
2. Extend RSVP summary tests to include parent aggregate doc + override doc-id shape (`uid__playerId`) and confirm one-player-one-bucket counting.

## Manual validation checklist
1. Parent (2 linked players) sets both to going for same event.
2. Coach overrides one player to can't go in game day.
3. Calendar and parent dashboard summary should show `1 going`, `1 can't go`, `0 maybe`, `0 no response` for 2-player roster.

## Residual risk
- Existing docs with missing/legacy player IDs still rely on fallback resolution path; covered by existing hydration tests but not expanded here.
