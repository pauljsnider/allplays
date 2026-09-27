# Problem Statement

The modern public team profile exposes team identity but not recent completed public results, even though the existing public games callable already provides sanitized projections.

# User Segments Impacted

- Parents and fans need fast, trustworthy scores without signing in.
- Coaches need results shown from the profiled team's perspective.
- Team administrators need scheduled, live, private, practice, and operational data to remain excluded.
- Anonymous mobile visitors need a layout that works without horizontal scrolling.

# Acceptance Criteria

1. Show a clearly labeled Recent results section.
2. Show at most five qualifying games, newest first.
3. Show opponent, date, current-team-first final score, and Win/Loss/Draw.
4. Accept only completed public games with valid opponent, date, and nonnegative numeric scores.
5. Exclude scheduled, live, private, practice, deleted, mismatched-team, and malformed records.
6. Use only the sanitized public profile and game projection boundaries.
7. Show an explicit empty state when no games qualify.
8. Keep essential content readable on narrow screens.
9. Clear prior-team results on route changes and retries.

# Non-Goals

- Standings, schedules, pagination, filters, score entry, new endpoints, or private detail links.
- Rosters, contacts, assignments, locations, notes, member data, or raw game documents.

# Edge Cases

- Equal scores are draws, including 0-0.
- Home and away games retain the current-team perspective.
- Sort before applying the five-item bound.
- A results request failure is distinct from a legitimate empty result set.
- Long opponent names wrap without causing horizontal overflow.

# Open Questions

- Assumption accepted for this slice: bounded means five.
- Assumption accepted for this slice: score order is current team first.
- Results failure will be non-fatal to the public identity profile.
