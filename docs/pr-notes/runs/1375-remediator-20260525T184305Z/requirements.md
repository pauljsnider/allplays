# Requirements

- One-tap game-day alerts must preserve existing custom notification preferences, especially `liveChat`.
- The action must not persist default or stale in-memory preferences when preference loading failed or team selection recently changed.
- If current preferences cannot be loaded at click time, fail safely and do not save preferences.
