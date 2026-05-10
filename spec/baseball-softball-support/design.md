# Baseball and Softball Support Design

## Overview

This feature adds baseball and softball as first-class sports using the existing multi-sport architecture. The core design choice is passive tracking: the product should feel useful on the sideline without turning into a formal scorebook.

The implementation should reuse existing patterns:

- Team creation auto-creates one `statTrackerConfigs` document.
- `edit-config.html` provides quick stat templates.
- Standard tracking remains config-driven through `track.html`.
- Live period labels are resolved by `js/live-sport-config.js`.
- Game planning extends the existing formation model.
- Practice planning extends existing drill taxonomies and starter content.

## Sport Templates

Baseball and softball use the same initial stat columns:

`AB, H, R, RBI, BB, FP`

`FP` means fielding play. It is intentionally broad so a passive scorekeeper can credit a defensive out, strong throw, catch, or other notable fielding contribution without choosing a formal scorebook code.

## Tracking Model

No new pitch-level tracker is introduced in this release. Baseball and softball games use:

- Existing standard stat tracker for player stats and score save/complete.
- Existing live tracker/event model where available.
- Inning labels from `getSportPeriodLabels()`.
- Existing config columns for stat tables and reports.

This keeps the blast radius low and preserves the current save paths.

## Game Planning

Add two formations:

- `baseball-9`: P, C, 1B, 2B, 3B, SS, LF, CF, RF
- `softball-10`: P, C, 1B, 2B, 3B, SS, LF, LCF, RCF, RF

For baseball and softball plans, default period labels should be seven innings. The planner also stores a `battingOrder` array on the game plan:

```js
{
  battingOrder: [
    { slot: 1, playerId: "..." },
    { slot: 2, playerId: "..." }
  ]
}
```

The existing defensive lineup grid remains the source for inning/position assignments.

## Practice Planning

Add baseball and softball taxonomies to the drill constants and seed a small built-in library that uses the current drill schema. Starter drills should cover:

- Warm-up throwing and catching
- Ground balls and throws to first
- Fly balls and communication
- Base running
- Tee/soft toss hitting
- Team defense or situational scrimmage

The same seed content can be used for both sports with sport-specific labels where helpful.

## Risks

- Existing game planning code is page-local, so adding batting order needs focused edits and tests.
- Generic stat tracking may not satisfy users expecting formal scorebook behavior. The requirement explicitly avoids that for this release.
- Practice drill AI prompts should remain useful when the sport is not soccer; templates and taxonomies reduce empty-state risk.

## Rollback

Rollback is limited to removing baseball/softball options and templates from team/config pages, reverting game-planning formation additions, and removing the added drill taxonomy/seed content. No data migration is required.

