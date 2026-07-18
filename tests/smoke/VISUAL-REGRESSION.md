# Visual regression testing

The required `preview-smoke` workflow runs five deterministic Playwright screenshot checks for the highest-value stable React app surfaces:

1. Join-code account creation (`AuthPage`).
2. Public opportunity discovery (`Discover`).
3. Mobile team launcher (`My Teams`).
4. Family schedule agenda (`Schedule`).
5. Mobile team-chat inbox (`Messages`).

These checks use the same module-mocked states as the existing behavior smoke tests. The visual guard blocks every non-local request and replaces remote images with a fixed transparent pixel, so Firebase, analytics, production data, CDNs, and clocks cannot change a baseline. Smoke configuration also fixes Chromium to UTC, `en-US`, light color mode, reduced motion, a 1x device scale, and stable desktop/mobile viewports.

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

If Docker is unavailable, dispatch the `update-visual-baselines` workflow for the branch, download its `visual-baselines-linux` artifact, and copy the contained `tests/` tree into the repository. That workflow uses the same `ubuntu-latest`, locked npm dependencies, and Playwright Chromium installation as `preview-smoke`.

If CI reports a screenshot mismatch, download the Playwright diff artifact or reproduce with the Linux script. Do not raise the pixel-difference budget or mask changed UI to make an unexplained failure pass.
