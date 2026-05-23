# Requirements

## Acceptance criteria
- Prefix a single quote to exported CSV cells whose first non-whitespace character is `=`, `+`, `-`, `@`, or `|`.
- Apply sanitization through `escapeCsvValue()` so every CSV cell uses the same policy.
- Preserve original text after the safe prefix; do not strip or mutate payload content.
- Keep existing CSV escaping behavior for commas, quotes, CR, and LF.
- Serialize empty, null, and undefined values as empty cells without a prefix.
- Leave safe values unchanged.

## Edge cases
- Formula values: `=1+1`, `+SUM(A1:A2)`, `-10+20`, `@HYPERLINK(...)`, `|cmd`.
- Leading spaces/tabs before formula markers.
- Dangerous values that also require CSV quoting, such as formulas containing commas or quotes.
- Multiline notes beginning with formula markers.
