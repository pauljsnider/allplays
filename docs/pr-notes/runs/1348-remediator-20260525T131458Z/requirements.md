# Requirements

## Acceptance Criteria

1. Stub and legacy-link capability CTAs with `legacyPath` open the hosted public URL, not a packaged WebView-relative path.
2. Native Capacitor builds use the existing native-aware public URL opener for legacy pages.
3. Native-shell capabilities continue to use internal React Router links.
4. Future capabilities and capabilities without a usable legacy path do not render a launch CTA.
5. Regression tests cover stub and legacy-link examples and protect against raw relative anchors.
