# Google Play listing

This directory is the version-controlled source for the `ai.allplays.lite`
Google Play listing.

- `app-details.json` contains the public support contact and default language.
- `en-US/listing.json` contains the English title and descriptions.
- `en-US/graphics/` contains the required icon, feature graphic, and phone
  screenshots.

Run `npm ci`, then regenerate assets with `npm run store:play:generate-assets`
and validate with `npm run store:play:validate`. After review, sync the listing
through the protected `mobile-release` GitHub environment with `npm run
store:play:sync`, or use the `sync_android_listing` workflow input.

The sync command replaces the image types represented in this directory as one
uncommitted Google Play edit, then commits only after every upload succeeds.
Credentials must come from `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`; never commit a
service-account key.
