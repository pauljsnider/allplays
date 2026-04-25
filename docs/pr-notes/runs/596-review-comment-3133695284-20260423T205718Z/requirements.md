# Requirements

## Objective
Preserve correct tournament pool standings for away games by treating stored `homeScore` and `awayScore` as team-relative scores, then remapping them to venue-relative scores before standings computation.

## Acceptance Criteria
- Away tournament games (`isHome === false`) swap both team names and scores before `computeNativeStandingsDetailed` runs.
- An away win stored as `homeScore > awayScore` for the team still records as a win for the team in pool standings.
- Existing home-game standings behavior stays unchanged.
- Unit coverage proves the away mapping and the multi-game pool aggregation path.

## User Risk
Incorrect standings can flip wins to losses on the public team page, which misleads coaches, parents, and tournament admins.

## Assumptions
- ALL PLAYS stores `homeScore` as the team score and `awayScore` as the opponent score in team-centric views.
- Tournament standings should consume venue-relative rows.
