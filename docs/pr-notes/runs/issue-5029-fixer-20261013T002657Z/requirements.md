# Requirements analysis

## Root cause

`uploadTeamMediaFile` already accepts, validates, and persists `options.order`,
while retaining its fallback order allocation and Storage cleanup when no order
is supplied. The missing contract is in the legacy page helper:
`uploadSelectedFiles` only forwards an order when it also performs a range
reservation. The document path therefore has no way to pass through an order
that was assigned elsewhere.

## Required behavior

- Accept preassigned document order values, including `0`, independently of
  reservation.
- Omit `order` when no value was provided so existing single-file fallback
  behavior remains unchanged.
- Preserve batch and per-file validation, sequential processing, progress,
  mixed-success reporting, folder selection, refresh, and input clearing.
- Preserve the original upload error message and red failure state.
- Preserve DB cleanup when persistence fails after upload.
- Do not add document reservation calls, change photo uploads, or broaden into
  batching, React, rules, sorting, paths, or notifications.

## Regression expectations

Exercise assigned document orders directly through the legacy upload helper,
including `0`; verify uploader invocation and no reservation call. Cover a
failed ordered document alongside a successful sibling to preserve failure
reporting. Keep a no-order assertion and the existing unsupported-document
validation coverage. Strengthen the nearest DB cleanup regression with an
explicit order.

Recurrence risk is medium because the existing boolean couples allocation and
propagation while uploads otherwise appear successful.
