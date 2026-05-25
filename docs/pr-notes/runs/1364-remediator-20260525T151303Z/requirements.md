# Requirements

- Acceptance criteria: Parent Tools must show a Pay action for team fee records with status `adjusted` when they have a positive remaining balance and either an existing checkout URL or enough identifiers to initiate checkout.
- Paid and canceled/cancelled fees remain ineligible. Zero-balance adjusted fees remain ineligible.
- Regression coverage must assert adjusted positive-balance fees remain payable and zero-balance adjusted fees do not.
