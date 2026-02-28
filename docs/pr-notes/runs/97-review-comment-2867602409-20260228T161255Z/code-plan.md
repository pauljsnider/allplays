# Code Role Notes

## Minimal Patch Plan
1. Update mixed-dataset logic in `js/live-tracker-resume.js` to include untimestamped events that appear after latest timestamped event.
2. Add unit test proving newest untimestamped event wins in mixed datasets.
3. Bump `live-tracker-resume` import cache version in `js/live-tracker.js`.
4. Run targeted unit tests and commit/push.
