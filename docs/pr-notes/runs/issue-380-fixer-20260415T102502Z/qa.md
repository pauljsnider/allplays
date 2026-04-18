# QA Plan

- Cover builder create/edit, public render, legacy compatibility, upload validation, and cleanup behavior.
- Prefer fast Vitest helper and static wiring checks for this repo.
- Manually validate one legacy profile and one native-media profile after code changes.

# Critical Test Scenarios

1. Normalize mixed uploaded and legacy clips without dropping data.
2. Preserve clip ordering and compute cleanup paths for removed media.
3. Preserve uploaded profile photo metadata when present.
4. Builder wiring exposes native upload and curation controls.
5. Public page wiring includes inline media rendering for uploaded clips.
6. Existing Firestore privacy rules and db read guard remain intact.

# Regression Risks

- Legacy URL-only clips could be dropped on edit.
- Reorder/remove flows could delete retained uploads.
- Custom headshot could be overwritten by season-derived photos.
- Public rendering could regress to links only or break private profile behavior.

# Lightweight Test Artifacts

- Extend `tests/unit/athlete-profile-utils.test.js` for richer media normalization and cleanup-path coverage.
- Extend `tests/unit/athlete-profile-wiring.test.js` for builder and public page media controls.

# Manual Validation Matrix

- Create profile with uploaded headshot and two uploaded clips.
- Edit that profile and reorder/remove media.
- Load an older URL-only profile and resave it.
- Verify a public share renders uploaded media inline.
- Verify a private profile still blocks read access for non-owners.