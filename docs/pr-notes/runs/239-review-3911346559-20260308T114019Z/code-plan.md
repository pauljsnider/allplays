Thinking level: low
Reason: the defect is localized, reproducible from the existing review note, and already covered by a dedicated helper test file.

Plan:
1. Correct `buildMirroredGamePayload(...)` so mirrored records point to the source team as their counterpart.
2. Update the existing unit assertion to encode the intended contract.
3. Run the focused unit test file and inspect the diff before committing.
