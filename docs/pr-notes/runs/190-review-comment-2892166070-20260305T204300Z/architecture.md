# Architecture Role Summary

## Decision
Introduce a dedicated runtime config resolver module and consume it from both Firebase initialization entry points.

## Design
- New module: `js/firebase-runtime-config.js`
- Main config resolution order:
  1. `window.__ALLPLAYS_CONFIG__.firebase` / `firebasePrimary` / `window.ALLPLAYS_FIREBASE_CONFIG`
  2. `GET /__/firebase/init.json` (Firebase Hosting)
- Image config resolution order:
  1. `window.__ALLPLAYS_CONFIG__.firebaseImages` / `firebaseImage` / `window.ALLPLAYS_FIREBASE_IMAGE_CONFIG`
  2. explicit error if missing

## Controls
- Enforces required key presence (`apiKey`, `authDomain`, `projectId`, `messagingSenderId`, `appId`) before initialize.
- Eliminates static credential literals from source-controlled module code.
- Preserves service worker runtime-config path already added for push messaging.
