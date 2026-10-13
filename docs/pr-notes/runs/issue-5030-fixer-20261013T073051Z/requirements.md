# Requirements analysis

## Scope

- For one valid document selected in the legacy Team Media form, reserve one media order before calling `uploadTeamMediaFile`.
- Pass that reserved integer through the helper's `options.order` field.
- Keep the existing progress rows, library reload, input clearing on success, selected album, and error summary behavior.
- A reservation consumed by an upload that later fails remains a harmless gap.
- Do not redesign multi-document uploads, photo uploads, Firestore transactions, sorting, pagination, paths, or notifications.

## Root-cause hypothesis

The legacy document form historically called the document helper without opting into the shared pre-upload reservation path. The helper could reserve only after storage upload, so concurrent uploads could receive order values in completion order. The current branch already contains a later multi-document opt-in; this slice makes the one-document path explicit and locks its contract with focused tests.

## Acceptance matrix

| Scenario | Reservation | Helper call | UI/result |
| --- | --- | --- | --- |
| One valid PDF succeeds | Once with count `1`, before upload | Receives reserved order | Success summary; input clears |
| One valid PDF upload fails | Once with count `1`, before upload | Receives reserved order | Existing error row/summary; input stays selected; gap is retained |
| Multi-document selection | Existing range behavior | Existing per-file orders | Unchanged |

## Role execution note

The requested `allplays-requirements-expert` skill was unavailable, and the accepted collector session failed before producing output with `published reply runtime missing for main`. This artifact records the main-run synthesis using the required role lens.
