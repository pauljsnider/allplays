# Problem Statement

Full-team email and durable team chat are separate workflows. Coaches must copy the same update manually, and there is no shared request, atomic write, reciprocal audit linkage, or combined success result.

# User Segments Impacted

- Coaches, owners, and admins need one mobile-friendly broadcast action.
- Parents need direct email plus a durable copy in Messages.
- Program managers need consistent communication and less duplicate work.

# Acceptance Criteria

1. Full team shows a default-on `Also post to team chat` control before send.
2. Enabled sends queue email and create exactly one full-team chat message containing subject then body.
3. Email and chat records contain reciprocal identifiers and are created in the initial batch.
4. Opt-out queues email without a chat document.
5. Selected-member and staff sends remain email-only, including stale or crafted cross-post flags.
6. Success reports recipient count and whether chat was created.
7. Cross-posts use the existing chat notification trigger and do not create duplicate team-email inbox records.
8. Existing authorization, recipient resolution, rate limits, drafts, templates, and history remain unchanged.

# Non-Goals

- Targeted or staff chat cross-posting.
- Chat attachments, alternate conversations, scheduling, retries, or historical backfill.
- Delivery-provider confirmation beyond queued mail jobs.

# Edge Cases

- Audience changes after the checkbox is enabled.
- Modified clients send `postToTeamChat: true` for a targeted audience.
- Initial batch failure, no eligible email recipients, repeated clicks, or special characters.
- Sheet reopen or team switch resets the full-team option to default-on.

# Open Questions

- Chosen text format: `${subject}\n\n${body}`.
- Chosen targeted behavior: safely coerce to email-only to preserve the existing workflow and prevent disclosure.
- Sent-history navigation to the linked chat post remains a later enhancement.
