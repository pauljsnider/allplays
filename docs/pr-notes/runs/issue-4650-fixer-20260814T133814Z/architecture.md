# Current-State Read

`TeamEmailSheet` and `chatService` submit an email-only contract. The callable writes team-email history and mail jobs in an initial batch, then creates separate `team_email` inbox records. Full-team chat uses `teams/{teamId}/chatMessages/{id}` and already has a notification trigger.

# Proposed Design

- Add `postToTeamChat` through the sheet, chat service, and app legacy adapter.
- Keep missing flags backward-compatible as email-only.
- Enable server cross-posting only for the final resolved `full_team` audience.
- Allocate email and chat refs before batching and store `chatMessageId` / `teamEmailMessageId` reciprocally.
- Write `${subject}\n\n${body}` using the established full-team chat schema.
- Commit email history, chat, optional draft transition, and first mail jobs atomically.
- Skip direct team-email inbox writes for cross-posts and rely on the existing chat trigger.
- Return additive `chatMessageId` and `chatPostCreated` fields.

# Files And Modules Touched

- `apps/app/src/pages/messages/components/TeamEmailSheet.tsx`
- `apps/app/src/pages/messages/components/TeamEmailSheet.test.tsx`
- `apps/app/src/lib/chatService.ts`
- `apps/app/src/lib/adapters/legacyChatService.ts`
- focused app service tests
- `functions/index.js`
- `functions/test/team-email-callable.test.cjs`

# Data/State Impacts

No migration. New cross-posted email records store `chatMessageId`; chat records store `teamEmailMessageId`. Email-only records remain sparse. The maximum first batch remains 403 writes.

# Security/Permissions Impacts

Authorization remains in `requireTeamEmailSender`. No client rule change is needed. Targeted recipient data and email attachments are never copied into full-team chat. Sender identity comes from authenticated server context.

# Failure Modes And Mitigations

- Targeted disclosure: server gates on final `targetType === 'full_team'`.
- Partial audit record: reciprocal documents share the initial batch.
- Duplicate notifications: no direct team-email inbox writes for cross-posts.
- Trigger failure: durable chat remains and retryable notification delivery is asynchronous.
- Ambiguous callable retry: existing non-idempotent behavior remains out of scope; each email record gets at most one linked chat document.
