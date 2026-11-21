# QA analysis

Add a prevention-oriented integration regression using the real createInviteEmailOnCreateHandler, createAutoAcceptParentInviteHandler, and buildParentInviteEmailMessage. Seed a team where the issuer is authorized only through adminEmails, resolve that issuer's email through the trigger's Auth dependency, and assert:

- no permission warning is emitted;
- the invite is durably accepted and auto-linked;
- the queued email has message kind linked.

This test fails against the prior wiring because the handler receives no Auth email and falls back to an ordinary invite message. Existing unit coverage already protects the warning-and-deliver fallback and queue retry behavior.

The requested allplays-qa-expert skill and role subagent were unavailable in this runtime. This artifact records the main-lane regression strategy.
