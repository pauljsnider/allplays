# QA notes

Targeted validation: run the two failing smoke specs in `tests/smoke/team-schedule-calendar.spec.js` with `playwright.smoke.config.js`.

Assertions covered: team header renders, practice-only calendar filter excludes games, tracked calendar duplicates remain hidden, cancelled calendar events stay out of upcoming buckets and appear in past-events.

Regression risk: additional `team.html` imports may need matching smoke stubs when tests intentionally isolate Firebase and related services.
