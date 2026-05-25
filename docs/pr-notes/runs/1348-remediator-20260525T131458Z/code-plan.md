# Code Plan

1. Import `openPublicUrl` in `apps/app/src/pages/CapabilityPage.tsx`.
2. For `stub` and `legacy-link` capability CTAs, build an absolute URL using `new URL(capability.legacyPath, 'https://allplays.ai').toString()`.
3. Replace the raw relative anchor with a button that invokes `openPublicUrl(legacyUrl)`.
4. Update unit tests to validate the native-safe opener and unchanged native-shell/future behavior.
