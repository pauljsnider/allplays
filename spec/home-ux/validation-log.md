# Home UX Improvements — Validation Log

## Required checks

- Focused Home component tests.
- App TypeScript/Vite production build.
- Relevant app smoke test or equivalent local browser boot validation.
- Responsive browser validation at 320x720, 390x844, tablet, and desktop.
- DOM checks for document overflow, current-section semantics, and live-region
  roles.
- Visual review of signed-out Home and signed-in states available in automated
  fixtures.

## Results

Completed July 18, 2026.

- `npx vitest run apps/app/src/pages/Home.test.tsx apps/app/src/components/AppShell.test.tsx --reporter=verbose`
  - Passed: 65 tests across 2 files.
- `npm run app:build`
  - Passed TypeScript, Vite production build, production artifact verification,
    and bundle visualizer verification.
- `npm --prefix apps/app run lint`
  - Passed with 0 errors. The command reports 2,547 existing repository
    warnings; this change does not make warnings fatal.
- `SMOKE_APP_BASE_URL=http://127.0.0.1:5174 npx playwright test tests/smoke/app-home-player.spec.js --config=playwright.smoke.config.js --reporter=line`
  - Passed: all 9 Home/player workflow tests, including the 320px and 1440px
    Home workspace cases and existing telemetry baselines.
- In-app browser visual and DOM review:
  - 320x720: no document overflow (`scrollWidth === innerWidth === 320`),
    all four welcome actions remained in bounds, and each measured 44px high.
  - 390x844: no document overflow (`scrollWidth === innerWidth === 390`) and
    all welcome actions measured 44px high.
  - 768x1024: no document overflow (`scrollWidth === innerWidth === 768`),
    benefit cards and public actions formed a stable tablet layout.
  - Desktop: welcome content remained centered inside the app workspace and
    primary actions measured 44px high.
  - Visual inspection found and fixed one CTA contrast defect caused by the
    shared primary-button gradient. The final Create account CTA computes to a
    white background, no background image, and indigo text.

The signed-in Today, Feed, Players, Teams, Friends, social quick-share, player
drill-in, mobile overflow, desktop navigation, and telemetry workflows were
validated through the module-mocked app smoke fixture.
