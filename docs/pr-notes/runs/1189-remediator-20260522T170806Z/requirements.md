# Requirements

- Resume log reconstruction must include normal stat and note live events only.
- Undo/remove reversal stat broadcasts must not become removable log entries after resume.
- A reversal stat broadcast is a stat live event with a negative value and a description beginning with `UNDO ` or `REMOVE `.
- Existing clock resume behavior and normal stat undo metadata must remain unchanged.

## Acceptance Criteria

- Normal positive stat events are reconstructed with undoData.
- Note events remain reconstructed.
- `UNDO ...` and `REMOVE ...` negative stat broadcasts are omitted from reconstructed state.log.
