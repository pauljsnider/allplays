# Requirements

## Problem Statement
Parent fee detail rendering can show incomplete invoice or installment information when the primary array field exists but is empty. Empty arrays currently block fallback to legacy or alternate fields, so parents may not see available line items or installment schedules.

## Acceptance Criteria
1. When a fee record has `lineItems: []` and `invoiceLineItems` contains one or more items, the parent fee UI displays the `invoiceLineItems` entries.
2. When a fee record has `installments: []` and `installmentSchedule` contains one or more entries, the parent fee UI displays the `installmentSchedule` entries.
3. When the primary field contains one or more entries, the UI uses the primary field and does not fall back.
4. When both primary and fallback fields are empty or missing, the UI shows the existing empty/no-detail behavior without errors.
5. Empty arrays are treated as no usable values for fee line items and fee installments only where fallback behavior is expected.
6. Existing scalar fallback behavior remains unchanged.

## Non-Goals
- No schema migration.
- No Firestore rules changes.
- No payment processing changes.
- No redesign of parent fee cards.
