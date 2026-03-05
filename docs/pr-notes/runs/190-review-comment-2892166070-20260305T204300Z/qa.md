# QA Role Summary

## Regression Targets
- App bootstrap on pages importing `js/firebase.js`
- Image upload/auth flows relying on `js/firebase-images.js`
- Push notification bootstrap path (already runtime-driven)

## Validation Plan
1. Static scan confirms no embedded Firebase credentials remain in targeted modules.
2. Syntax check for modified JS modules.
3. Manual smoke checklist:
   - load login flow with runtime config present
   - verify upload flow with image config present
   - verify explicit error when image config is absent

## Residual Risk
- Environments not setting runtime config may fail at startup; mitigated via README update and explicit runtime error message.
