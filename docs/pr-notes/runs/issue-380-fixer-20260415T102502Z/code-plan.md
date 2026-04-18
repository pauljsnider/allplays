# Implementation Plan

1. Extend athlete-profile normalization to support uploaded clips, custom headshots, validation, and cleanup-path calculation.
2. Add athlete-profile-specific upload/delete helpers in `js/db.js` and teach `saveAthleteProfile()` to preserve richer media metadata and clean up removed objects.
3. Update `athlete-profile-builder.html` with headshot upload, uploaded clip add flow, external-link fallback, reorder/remove controls, and pre-save upload handling.
4. Update `athlete-profile.html` to render uploaded images/videos inline while keeping legacy link rendering.
5. Extend Vitest coverage for helper normalization and wiring.

# Reusable Patterns

- Reuse `imageStorage` plus `requireImageAuth()` from existing upload helpers.
- Reuse `uploadBytes`, `getDownloadURL`, and `deleteObject` patterns already used in chat/stat-sheet uploads.
- Keep array order as the curated order, matching existing builder DOM order.

# Proposed File Changes

- `js/athlete-profile-utils.js`
- `js/db.js`
- `athlete-profile-builder.html`
- `athlete-profile.html`
- `tests/unit/athlete-profile-utils.test.js`
- `tests/unit/athlete-profile-wiring.test.js`

# Test Strategy

- Write helper tests first for rich clip normalization and cleanup calculation.
- Update static wiring tests for upload controls and inline media rendering markers.
- Run targeted Vitest files, then the full athlete-profile test subset.

# Known Unknowns

- Storage rules for the image bucket are outside this repo.
- No built-in clip trimming exists in this patch.
- No existing internal clip picker is added in this MVP.