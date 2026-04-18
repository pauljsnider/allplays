# QA Risks
- Memory leak persists if any preview lifecycle path skips revocation.
- Regression risk if remote saved media or linked season photos are treated like blob previews.
- Regression risk if removing a clip clears UI state without preserving remaining clip order or metadata.

# Test Matrix
- Upload headshot, replace with another headshot: prior blob preview revoked, latest preview visible.
- Upload headshot, press reset: blob preview revoked, linked season photo shown.
- Upload one or more clips, remove one pending clip: removed clip preview revoked, remaining clips stay intact.
- Load an existing saved athlete profile after pending uploads existed: pending blob previews revoked, saved hosted URLs render.
- Keep existing saved remote media only: no revocation side effects, public profile/share wiring unchanged.

# Regression Guardrails
- Keep revocation blob-only.
- Keep cleanup in builder-only paths, not persistence helpers.
- Preserve existing unit coverage for athlete profile wiring and add explicit assertions that cleanup code exists.

# Manual Checks
- `athlete-profile-builder.html`: upload/replace/reset headshot.
- `athlete-profile-builder.html`: upload/remove/reorder clips, then save.
- Reload builder for the saved profile and confirm hosted media still renders.
- Open `athlete-profile.html` for the same profile and confirm public rendering still works.