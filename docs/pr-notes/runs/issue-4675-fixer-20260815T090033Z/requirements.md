# Requirements

## Problem Statement

Authorized staff cannot inspect the parent-facing registration experience from an unsaved draft. The public route correctly rejects unpublished forms, leaving no safe preview path before publication.

## Acceptance Criteria

1. Authorized staff can open **Preview as parent** for new, draft, published, and closed forms.
2. Preview content comes from current unsaved editor state.
3. Preview shows title, description, season, active options, participant and guardian fields, fee and active discounts, payment-plan choices, and waiver text.
4. Preview is clearly read-only and exposes no registration submission or checkout action.
5. Opening, interacting with, and closing preview performs no save or write and preserves unsaved editor values.
6. Mobile content remains readable and free of horizontal overflow.
7. Inactive options and discounts remain hidden.
8. The public loader continues rejecting draft, closed, and archived forms.

## Non-Goals

- Draft-only public URLs or weaker public access controls.
- Registration submission, waiver acceptance, capacity reservation, or checkout.
- Exact conditional-discount simulation.
- Legacy admin editor changes or a broad parent-registration refactor.

## Edge Cases

- Incomplete new drafts and validation errors.
- Closed or published forms with unsaved edits.
- No active options, long labels, zero fees, and incomplete payment-plan dates.
- Repeated open and close cycles without losing edits.
