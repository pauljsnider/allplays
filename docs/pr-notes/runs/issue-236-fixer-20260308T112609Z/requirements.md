Objective: let admins schedule bracket games before opponents are known and have linked-team calendars stay aligned once a real opponent is selected.

Current state:
- Team schedules support free-text opponents and optional linked opponent teams.
- Creating or editing a linked game only changes one team's `games` document.
- Placeholder tournament games can be typed manually, but there is no automatic propagation to the opponent team's calendar.

Proposed state:
- Preserve free-text placeholder scheduling for tournament rounds.
- When a game is linked to another allplays team, create and maintain a mirrored game document on the opponent team.
- Mirror later updates for date, location, status, result, and core schedule metadata so replacing a placeholder with a real team updates both calendars.

Acceptance:
1. A scheduled tournament game with only a text opponent remains a single-team placeholder fixture.
2. A linked tournament game creates a mirrored opponent-team fixture with inverted home/away perspective and swapped scores.
3. Updating or unlinking a linked game updates or removes the mirrored opponent-team fixture.
4. Existing non-linked schedule flows continue to behave the same.
