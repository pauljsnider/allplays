Code plan

1. Update game-day.html loadRsvps() to return true on success and false on caught error.
2. Update js/game-day-rsvp-controls.js to remove manual renderRsvpPanel() call after reload and gate Saved status on the boolean result.
3. Run lightweight validation and commit only the scoped files.
