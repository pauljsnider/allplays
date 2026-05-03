# QA Plan

- Run unit tests with `npm test`.
- Manually inspect Firestore rules to confirm non-admin officiating updates require game-level authorization arrays.
- Manually inspect `edit-schedule.html` to confirm new officiating rows get unique IDs and saved game data includes normalized authorization arrays.
