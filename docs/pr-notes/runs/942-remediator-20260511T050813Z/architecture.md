# Architecture notes

- Keep the existing client-side Firebase flow and avoid broad refactoring.
- Use the access-code transaction as the claim gate, then validate the claimed invite email against the current auth email before any side-effect writes.
- Track prior family membership state and add a compensating rollback helper that removes granted user/player links, restores membership when touched, and finally resets the access code.
- Rollback is best-effort but comprehensive; it logs rollback failures and preserves the original redemption error.
