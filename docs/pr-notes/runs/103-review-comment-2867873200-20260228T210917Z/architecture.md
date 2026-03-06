# Architecture Role Output

## Scoped Design
- Replace naive `field.split(';')` with a small state-machine tokenizer that only splits on semicolons outside quotes and outside escape mode.
- Centralize parameter decoding in `decodeICSParamValue()`.

## Parsing Rules Applied
- Remove only balanced outer quotes.
- Decode backslash escapes for `\\`, `\;`, `\,`, `\:`, `\"`.
- Decode RFC6868 caret escapes: `^^`, `^n`, `^'`.

## Tradeoffs
- Keeps parser lightweight with no external dependency.
- Adds tolerance for non-ideal ICS producers while preserving strict TZID resolution downstream.

## Control Equivalence
- No permissions or data-flow changes.
- Failure mode remains safe: unresolved or malformed timezone still drops event date with warnings.
