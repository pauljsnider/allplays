# Requirements analysis

## User-visible requirement

Legacy document uploads must keep their assigned album order when the form
submits them. A failed file must still show its original failure message while
successful siblings complete, refresh the library, and clear the file input.

## Acceptance interpretation

- The document form should use the same existing order-assignment path as the
  legacy photo form.
- An assigned value of `0` is valid and must be forwarded.
- The shared upload helper must continue omitting `order` when an indexed value
  is unavailable so the lower-level uploader can use its existing fallback.
- Unsupported files, progress rows, selected-album preservation, partial
  success summaries, and failure styling must remain unchanged.

## Scope boundaries

Do not change the range-reservation primitive, batch size, photo workflow,
React Team Media, Firestore rules, item sorting, pagination, Storage paths, or
notifications.

## Root cause

The document form did not opt into the existing reservation/assignment branch
of `uploadSelectedFiles`. As a result, `uploadTeamMediaFile` received only a
progress callback and independently allocated an order after each upload.
