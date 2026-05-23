# Requirements

- First successful Apply with a selected stat sheet uploads the image once and saves its URL to the game.
- Repeated Apply without selecting a new file must reuse the saved URL and must not call `uploadStatSheetPhoto` again.
- Repeated Apply must still update corrected player mappings, scores, opponent stats, and completed status.
- If a different stat sheet file is selected after a save, the next Apply uploads that new file once and updates `statSheetPhotoUrl`.
- Existing overwrite confirmation behavior must remain intact.
- Apply and summary flow must remain available for corrections after save.
