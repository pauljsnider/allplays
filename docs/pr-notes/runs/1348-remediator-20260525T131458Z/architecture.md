# Architecture

## Decision

Route legacy capability CTAs through `openPublicUrl` from `apps/app/src/lib/publicActions.ts` with an absolute `https://allplays.ai/{legacyPath}` URL.

## Why

`openPublicUrl` already centralizes Capacitor Browser handling and web fallback behavior. Using it keeps legacy pages outside the packaged app WebView route context while preserving current hosted legacy page access.

## Risk And Rollback

Blast radius is limited to the `Open current page` CTA for `stub` and `legacy-link` capabilities. Rollback is a single-file revert in `CapabilityPage.tsx` plus test rollback, but that would reintroduce the native broken-link behavior.
