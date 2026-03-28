Thinking level: medium, because the bug sits at the parser-to-expander boundary and a small guard change can alter imported event shape.

Architecture read:
- `parseICS()` collects raw VEVENTs.
- `buildICSOccurrences()` splits masters and overrides by `UID`.
- Sparse overrides are expected: `buildICSOverrideOccurrence()` merges override fields onto the master and drops cancelled exceptions.

Decision:
- Do not change override expansion or merge behavior.
- Only change raw-event retention so sparse exceptions are not discarded before `buildICSOccurrences()`.

Why this path:
- Smallest change that restores expected ICS semantics.
- Preserves current filtering for malformed standalone VEVENTs.
- Keeps blast radius inside one parser condition plus focused tests.
