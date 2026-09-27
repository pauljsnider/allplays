# Requirements

## Acceptance interpretation

- The configured authentication flows do not provide a verified recipient phone claim. Editable profile phone data is not identity proof.
- A phone-only submission must stop before code generation, persistence, history insertion, or success UI and direct the inviter to use email.
- Email-only and email-plus-phone submissions remain email-targeted and continue to work.
- Existing historical phone-only invites remain unchanged; this slice only blocks new creation.

## Decision table

| Email | Phone | Result |
| --- | --- | --- |
| Empty | Empty | Existing required-contact validation; no write |
| Empty | Present | Phone-only unavailable guidance; no write |
| Present | Empty | Create email-targeted invite |
| Present | Present | Create email-targeted invite with phone as optional metadata |

## UX and regression requirements

- Keep the phone entry available as optional contact context, but state that it cannot target an invite alone.
- Preserve the entered phone after rejection so the inviter can add email and retry.
- Test the Profile form rejection and unchanged email success path.
- Test service-boundary rejection before code generation, SDK persistence, or REST fallback.

## Root-cause hypothesis

The Profile form and service treated any nonempty phone as an equivalent identity target even though the supported authentication contract exposes verified email but no verified phone identity. This allowed creation of an invite the intended recipient could not securely prove ownership of.
