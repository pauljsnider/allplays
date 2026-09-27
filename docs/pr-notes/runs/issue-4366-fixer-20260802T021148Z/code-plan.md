# Code plan

1. Add a private canonical Stripe Checkout URL helper beside legacy alias normalization.
2. Apply it to the first populated checkout alias so rejected data never reaches rendering and naturally enables the existing retry button.
3. Add visible recovery copy for payable online fees that have neither a trusted URL nor complete retry identifiers.
4. Update conflicting `pay.example` happy-path fixtures to canonical Stripe URLs.
5. Add table-driven regression cases proving rejected destinations never render or leak and missing/invalid states remain recoverable.
6. Run the focused Vitest file, inspect the intended diff, and commit the code, tests, and role artifacts together.
