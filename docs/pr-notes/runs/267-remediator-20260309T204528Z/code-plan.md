# Code plan

- Add delete support export in js/firebase.js if missing.
- Add deleteChatAttachments helper in js/db.js that deletes known attachment paths from the correct storage bucket.
- Update team-chat.html sendMessage() to upload sequentially, track successes, and clean them up on any subsequent failure before showing the existing send error.
