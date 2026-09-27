# QA Strategy

Run one deterministic sequential scenario against shared durable state:

1. Create a permitted invite and assert the complete Player-consumed result plus exactly one access-code and one mail record.
2. Repeat with equivalent email case/whitespace and assert the same ID/code, `reused: true`, unchanged record counts, and unchanged rate-limit counters.
3. Request a different recipient with `senderMaxInvites: 1`; assert `resource-exhausted`, positive retry details, unchanged record counts, and no partial recipient reservation.

The harness uses fixed time and invite code, counts final documents rather than calls, and fires the email trigger only for committed access-code creates. No emulator, network, wall clock, app build, native build, or broad smoke suite is required.

Focused command:

```bash
cd functions
node --test test/co-parent-invite-integration.test.cjs
```
