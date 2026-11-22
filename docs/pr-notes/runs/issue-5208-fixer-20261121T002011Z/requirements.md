# Requirements analysis

The parent receiving the invite must get one deterministic message based on the durable invite state. When the recipient already has an account and the issuer is an authorized team co-admin, the server trigger must complete auto-linking before it builds the email, so the message says the account is connected and does not ask the parent to enter a code.

The fix must preserve the existing fallback: if authoritative issuer lookup or auto-linking fails, log the warning and still queue the ordinary invite rather than suppressing delivery.

The requested allplays-requirements-expert skill and role subagent were unavailable in this runtime. This artifact records the main-lane requirements synthesis after applying the requested UX, coach, parent, and sports-manager perspectives.
