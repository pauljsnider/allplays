# Requirements

- Schedule update notifications must not show a UTC-derived time when the event lacks an explicit timezone.
- If an event timezone is available on the new or prior game document, include the localized date/time in the payload.
- If no timezone is available, use the safe generic date/time changed body.
- Unit coverage must prove both timezone-aware formatting and no-timezone fallback behavior.
