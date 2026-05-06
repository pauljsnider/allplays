# Requirements

- Preserve existing jersey numbers when matched-player CSV updates omit the Number header.
- Continue to update jersey numbers when a Number/Jersey header is present.
- Treat omitted optional fields as no-change for existing players.
- Allow new players without a Number header to be created without a number value.
- Keep the fix limited to roster CSV import planning. No permissions or roster visibility changes.
