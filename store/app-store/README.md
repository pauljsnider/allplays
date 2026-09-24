# App Store listing assets

This directory is the version-controlled source for the `ALL PLAYS` iOS store
listing and screenshots. The images are generated from deterministic, reviewed
app visual snapshots rather than live customer data.

- `en-US/listing.json` records the factual copy and canonical public URLs used
  in App Store Connect.
- `iphone-6.9/` uses Apple's accepted 1320×2868 portrait size.
- `ipad-13/` uses Apple's accepted 2048×2732 portrait size.
- Each image shows the real ALL PLAYS interface with a concise branded frame.

Run `npm ci`, then `npm run store:app-store:generate-assets`. Visually inspect
all four outputs before uploading them to the matching App Store Connect
screenshot sets.
