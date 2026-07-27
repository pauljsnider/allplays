# Visual regression testing

The required `preview-smoke` workflow runs five deterministic Playwright screenshot checks for current app workflows:

1. Join-code account creation (`AuthPage`).
2. Public opportunity discovery (`Discover`).
3. Mobile team launcher (`My Teams`).
4. Family schedule agenda (`Schedule`).
5. Mobile team-chat inbox (`Messages`).

These checks use module-mocked states rather than live data. The visual guard freezes the browser clock, blocks every non-local request, and replaces remote images with a fixed transparent pixel, so Firebase, analytics, production data, CDNs, and time cannot change a baseline. Smoke configuration fixes Chromium to UTC, `en-US`, light color mode, reduced motion, a 1x device scale, and stable desktop/mobile viewports.

Snapshot file names are platform-neutral. Their pixels are generated and compared only in the locked Linux/Chromium environment so developer operating-system font rendering cannot rewrite a baseline.
The comparison permits zero changed pixels, ensuring that even small copy changes remain visible to review.

## Run visual checks

Start both preview servers, then run:

```bash
SMOKE_BASE_URL=http://127.0.0.1:4173 \
SMOKE_APP_BASE_URL=http://127.0.0.1:5174 \
SMOKE_SUITE=preview \
npm run test:smoke:visual
```

Do not create or update baselines directly on macOS or Windows. Font rasterization and browser platform details differ even when the page is correct.

## Update baselines

Review the rendered change first, then generate baselines in the same Playwright 1.61.1 Ubuntu/Chromium image used to pin the expected output:

```bash
./scripts/update-visual-baselines-linux.sh
```

The script mounts only the repository, keeps Linux `node_modules` in disposable Docker volumes, starts the static and Vite servers inside the container, and writes Linux snapshot PNGs back to the relevant `tests/smoke/*.spec.js-snapshots/` directories. Commit only intentional PNG changes with the code that changed the UI.

If Docker is unavailable, dispatch the `update-visual-baselines` workflow for the branch and download its `visual-baselines-linux` artifact. Copy the artifact's `smoke/` directory into the repository's `tests/` directory. That workflow uses the same `ubuntu-latest`, locked npm dependencies, and Playwright Chromium installation as `preview-smoke`.

If CI reports a screenshot mismatch, download the Playwright diff artifact or reproduce with the Linux script. Do not raise the pixel-difference budget or mask changed UI to make an unexplained failure pass.
