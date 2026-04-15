# Architecture Decisions

- Keep `athleteProfiles/{profileId}` as the single Firestore record.
- Expand `clips[]` to support native uploaded media plus legacy external links.
- Add optional uploaded `profilePhotoUrl/profilePhotoPath` so parents can manage a dedicated headshot.
- Store athlete-profile media in the image bucket under `athlete-profile-media/{parentUserId}/{profileId}/...`.
- Upload first, save Firestore second, then best-effort delete removed media paths.
- If save fails after upload, best-effort delete newly uploaded objects in the builder flow.

# Data Model

```json
{
  "clips": [
    {
      "id": "clip_123",
      "source": "upload|external",
      "mediaType": "video|image|link",
      "title": "...",
      "label": "...",
      "url": "https://...",
      "storagePath": "athlete-profile-media/{parentUserId}/{profileId}/...",
      "mimeType": "video/mp4",
      "sizeBytes": 123456,
      "uploadedAtMs": 1760000000000
    }
  ],
  "profilePhotoUrl": "https://...",
  "profilePhotoPath": "athlete-profile-media/{parentUserId}/{profileId}/..."
}
```

# Affected Files

- `athlete-profile-builder.html`
- `athlete-profile.html`
- `js/athlete-profile-utils.js`
- `js/db.js`
- `tests/unit/athlete-profile-utils.test.js`
- `tests/unit/athlete-profile-wiring.test.js`

# Security And Blast Radius

- Firestore blast radius stays within the existing parent-owned athlete profile boundary.
- Media uploads reuse the isolated image-storage app and a dedicated athlete-profile prefix.
- Public profiles intentionally expose their media URLs.
- No fallback to main storage for this feature, to avoid widening storage scope.

# Rollback Plan

- Revert builder/public rendering plus helper and db changes.
- Uploaded media entries degrade to links because `url` remains canonical.
- Leave uploaded objects in place during immediate rollback to avoid breaking saved profiles.