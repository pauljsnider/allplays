# Architecture role notes

Control playbook status: requested skills (`allplays-orchestrator-playbook`, role skills) are not available in this runtime, so inline role analysis was used.

Risk/blast radius assessment:
- Recipient identity resolution change is server-side only and reduces authorization bypass risk.
- Token chunking affects only send fanout logic and preserves payload semantics.
- Image-only push fallback only changes message body for chat notifications.

Proposed state: retain current structure in `functions/index.js` and apply no refactor beyond scoped thread closure.
