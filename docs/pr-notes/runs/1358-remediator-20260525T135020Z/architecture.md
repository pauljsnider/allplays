# Architecture

## Decision
Guard paid registrations before building or writing caller-supplied cancellation updates in `releaseRegistrationCheckoutCapacity`.

## Risk
Minimal blast radius: only changes the paid-registration branch in the transaction. It preserves existing behavior for already-released and open non-paid registrations.
