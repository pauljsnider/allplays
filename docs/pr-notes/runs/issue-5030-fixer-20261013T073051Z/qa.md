# QA analysis

## Focused regression strategy

Use `tests/unit/team-media-legacy-upload-forms.test.js`, which boots the real legacy page module with mocked database/upload boundaries.

### Successful single document

- Select one valid PDF and submit the document form.
- Resolve the reservation with a distinctive order.
- Assert one reservation call with `('team123', 'folderA', 1)`.
- Assert the reservation call occurs before `uploadTeamMediaFile`.
- Assert the helper receives the reserved order and progress callback.
- Assert the success message and input clearing remain intact.

### Failed single document

- Reserve a distinctive order, then reject the document helper.
- Assert the helper still receives the reserved order.
- Assert the error row and `0 files uploaded, 1 failed.` summary remain intact.
- Assert library reload, album selection, and the uncleared failed input remain unchanged, demonstrating that the reserved gap is not reclaimed.

## Focused command

`npx vitest run tests/unit/team-media-legacy-upload-forms.test.js --reporter=verbose`

## Role execution note

The requested `allplays-qa-expert` skill was unavailable, and the accepted collector session failed before producing output with `published reply runtime missing for main`. This artifact records the main-run synthesis.
