## Architecture Role

- Decision: keep atomic persistence centralized in `js/admin-invite.js`; fix callers instead of widening the helper API again.
- Why: restoring the removed parameters would re-couple signup flows to the old multi-step persistence path and weaken the refactor that issue #305 intended.
- Controls: team lookup and profile lookup still happen in `redeemAdminInviteAcceptance(...)`, and the atomic DB write remains the only place that grants admin access and consumes the code.
- Rollback: revert the caller argument cleanup commit if a downstream consumer unexpectedly depends on the removed shape.
