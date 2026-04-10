# Requirements Role (allplays-requirements-expert)

## Objective
Keep cancelled games out of the public homepage "Live & Upcoming Games" list so visitors are not sent into a misleading watch flow.

## Current vs Proposed
- Current: homepage upcoming cards treat cancelled games like ordinary scheduled games.
- Proposed: cancelled games are excluded from the homepage live/upcoming feed and no watch link is rendered for them there.

## User Impact
- Visitors should only see genuinely live or upcoming watchable games.
- Staff cancellation actions should propagate cleanly to the public homepage experience.

## Acceptance Criteria
1. A game with `status: 'cancelled'` does not render in the homepage live/upcoming list.
2. Non-cancelled upcoming games still render with their normal watch/details link.
3. Existing live-game and replay homepage behavior remains unchanged.

## Risks
- If filtering only happens at render time, other consumers of the same query could still receive cancelled games.
- If filtering happens too broadly, valid scheduled games could disappear from the homepage.
