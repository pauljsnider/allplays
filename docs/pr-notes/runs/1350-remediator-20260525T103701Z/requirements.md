# Requirements

Acceptance criteria:
- A submitted online-checkout registration must not show checkout success unless the checkout URL is actually opened.
- If checkout session creation fails after registration creation, show user guidance that registration exists but payment did not start.
- Option-less online-checkout forms must not pass an empty option ID into checkout initiation when the form does not require options.
- Checkout initiation must use the server-stored registration amount/currency returned from submitOfflineRegistration, falling back only when unavailable.
