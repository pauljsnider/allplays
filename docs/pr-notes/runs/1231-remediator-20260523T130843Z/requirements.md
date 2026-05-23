# Requirements

## Acceptance Criteria
- CSV exports neutralize spreadsheet formula injection before download.
- Fields that start with `=`, `+`, `-`, or `@`, including after leading whitespace, are prefixed with a single quote.
- Fields containing a pipe followed by a formula marker, such as `|=`, `|+`, `|-`, or `|@`, are prefixed with a single quote.
- Existing CSV escaping for commas, quotes, newlines, null, and undefined values remains unchanged.

## Edge Cases
- User-controlled names, admin notes, and references can contain dangerous formula-like text.
- Sanitization must happen in the shared CSV value serializer so all exported columns receive identical protection.
