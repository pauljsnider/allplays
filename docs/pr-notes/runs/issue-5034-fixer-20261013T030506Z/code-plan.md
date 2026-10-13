# Code plan

## Minimal patch

1. Export `uploadSelectedFiles` as a narrow test seam and add an optional
   `assignedOrders = []` parameter.
2. Seed its local order list from `assignedOrders`; retain the existing photo
   range-reservation behavior.
3. Forward `order` whenever the indexed value is defined, independent of
   whether this helper reserved it.
4. Add legacy helper tests for assigned-order invocation, partial-failure
   reporting, and no-order compatibility.
5. Strengthen the existing DB cleanup test to exercise a preassigned order.
6. Run the two focused Vitest files, review the diff, and commit implementation,
   tests, and role artifacts with an issue-referencing message.

## Prevention / learning

Keep order allocation and order propagation as separate contracts. Test
optional numeric fields with `0`, a nonzero value, and absence, and exercise
failure cleanup with the optional field supplied.

The requested role skills and RCA playbook were unavailable in this runtime.
Four analysis-only role agents performed the equivalent requirements,
architecture, QA, and code-plan reviews before implementation.
