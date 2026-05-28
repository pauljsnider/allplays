# Code Plan

- Change `formatScheduleUpdateDate` so it returns empty when no timezone is supplied.
- Change `buildScheduleUpdateNotificationPayload` to pass only the resolved explicit timezone, not UTC.
- Update the existing timezone unit test to use a standard-time timestamp/date pair that unambiguously formats to 7:30 PM in America/Chicago.
- Add a regression unit test for legacy/no-timezone date changes using the generic safe body.
