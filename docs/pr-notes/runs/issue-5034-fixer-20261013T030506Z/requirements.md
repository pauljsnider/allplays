# Requirements analysis

## Root cause

`uploadTeamMediaFile` already accepts, validates, and persists `options.order`
while retaining fallback order allocation and Storage cleanup when no order is
supplied. The legacy page helper, `uploadSelectedFiles`, only forwards an order
when it also performs a range reservation. A document order assigned elsewhere
therefore cannot pass through the helper.

## Required behavior

- Accept preassigned document order values, including `0`, independently of
  reservation.
- Omit `order` when no value was provided so existing single-file fallback
  behavior remains unchanged.
- Preserve validation, progress, sequential processing, mixed-success
  reporting, library refresh, selected-folder behavior, and input clearing.
- Preserve the original upload error message and red failure state.
- Preserve DB cleanup when persistence fails after upload.

## Scope boundaries

- Do not add document order-range reservation calls or wire orders from forms.
- Do not change multi-document batching, photo uploads, React Team Media,
  Firestore primitives or rules, sorting, pagination, Storage paths, or
  notifications.

## Risks

- A truthiness check would drop valid order `0`; test for `undefined` instead.
- Sparse assignments must omit `order` for the missing indices.
- Recurrence risk is medium because allocation and propagation are coupled by
  one boolean and uploads can succeed while silently receiving fallback order.
