# Code Plan

- Update `turnOnGameDayAlerts` in `Profile.tsx` to capture `teamId`, load fresh preferences, merge `gameDayDefaultPreferences`, enable push, then save.
- Do not change manual preference save behavior.
- Add/adjust tests to verify the one-tap flow uses freshly loaded preferences and preserves existing custom values.
