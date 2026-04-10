Implementation plan:
- Add helper to notify user when save succeeded but schedule notification side effects failed.
- Wrap maybeNotifyScheduleChange + sent=true metadata update in separate try/catch for game and practice submits.
- Add currentRsvpRequestToken state and capture request-scoped datasets before await.
- Ignore stale RSVP success/error completions before mutating modal content or reminder context.
