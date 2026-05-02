# Implementation Plan

1. Add Firestore rule helpers for assigned official authorization by UID/email using denormalized primitive arrays.
2. Change game update allow rule so officiating-only updates require assigned official authorization, not only sign-in.
3. Add edit-schedule helpers to generate unique slot IDs and derive `officiatingAuthorizedUserIds` / `officiatingAuthorizedEmails` from saved slots.
4. Run the repository unit tests and commit scoped changes.
