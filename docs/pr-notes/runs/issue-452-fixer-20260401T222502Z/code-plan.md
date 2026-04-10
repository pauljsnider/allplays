# Code Role

Plan:
1. Add a helper that merges global-calendar ICS events into existing DB events while suppressing tracked UIDs and same-slot duplicates.
2. Wire `calendar.html` to use that helper instead of the inline loop.
3. Add regression tests for:
   - schedule import helper tracked-UID reload behavior
   - calendar-page helper and rendered calendar output after tracking
4. Run targeted Vitest coverage, then the full unit suite if the change stays isolated.

Minimal patch goal:
- Keep existing data contracts intact.
- Avoid refactoring unrelated schedule or RSVP logic.
