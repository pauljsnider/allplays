# QA role

- Regression risk: low and localized to athlete-profile save/edit flows that summarize selected seasons.
- Validation focus:
  - Add a static unit assertion that `buildAthleteProfileSeasonSummary()` requests inactive teams explicitly.
  - Run the focused athlete-profile unit file.
- Manual spot check to mention in PR context:
  - Save an athlete profile using a linked season from an inactive team and confirm the save succeeds with season data present.
