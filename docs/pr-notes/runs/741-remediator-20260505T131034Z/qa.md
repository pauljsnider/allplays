# QA Plan

## Manual Validation
1. Open `track-live.html` for a football-configured game.
2. Before starting the timer, tap a football play and confirm the existing start-timer alert appears and no event should be broadcast.
3. Start the timer, then stop/pause it after elapsed time is non-zero.
4. Tap Rush, Penalty, or another football play while paused.
5. Confirm the local game log receives the play and the live viewer play-by-play receives a `football_play` event with the paused `gameClockMs`.
6. Resume the timer and confirm running-clock football plays still broadcast.
7. Confirm turnover, punt, and kickoff still toggle possession after logging.

## Automated Gate
No repo test runner exists. Use syntax inspection and targeted grep/diff for this static HTML change.
