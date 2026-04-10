Manual validation focus:
1. Create/update a game with notifications enabled while forcing postChatMessage failure; expect save to persist, schedule reload, and warning alert about notification failure.
2. Create/update a practice with same failure mode; expect identical partial-success behavior.
3. Open RSVP modal for event A, then quickly for event B while delaying A response; expect modal content/reminder context to reflect only B.
4. Verify reminder button stays hidden when latest event has zero missing RSVPs.
Residual risk: manual-only validation because repo has no automated runner for this page.
