# Requirements role notes

Objective: close unresolved PR #190 review threads for notification recipient trust, FCM multicast limits, and image-only chat pushes.

Current state (validated in `functions/index.js`):
- Admin recipients are resolved with `admin.auth().getUserByEmail()` (`getUserIdsByEmails`) rather than mutable `users.email` profile fields.
- Notification sends are chunked to 500 tokens per `sendEachForMulticast` call.
- Team chat notifications now trigger when either `text` or `imageUrl` exists.

Decision: keep behavior and only make minimal wording alignment for image-only fallback body text.

Assumptions:
- Team `adminEmails` is an intentional source-of-truth list for admin identities.
- Firebase Admin SDK auth lookup is trusted identity data for email->uid mapping.
