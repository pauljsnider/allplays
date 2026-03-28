# Architecture

- Smallest viable change: patch the remaining direct helper call in `login.html` to the coordinator instance already used elsewhere.
- Blast radius: one email/password submit success path in the login page; no backend or Firebase rule changes.
- Controls: keep redirect calculation centralized in the coordinator module to reduce future divergence.
