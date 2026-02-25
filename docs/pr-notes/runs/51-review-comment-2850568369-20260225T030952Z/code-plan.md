# Code Role (allplays-code-expert)

## Patch Plan
- Edit `game-day.html` `pickBestGameId` only.
- Add helper predicates for normalized status checks.
- Change scheduled-future filter to exclude cancelled + completed.
- Keep fallback logic unchanged except reuse helper for cancelled check consistency.

## Conflict Resolution
- Requirements requested exclusion of completed only in scheduled-future path.
- Architecture and QA agreed this minimizes blast radius while fixing coach routing.
- Final implementation follows that scoped approach.
