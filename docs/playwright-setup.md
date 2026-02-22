# Playwright Setup & CI Runbook

## Overview

This project uses [Playwright](https://playwright.dev/) for end-to-end and smoke testing.
Tests run automatically in CI via GitHub Actions and can be run locally against the static dev server.

---

## Local Setup

### 1. Node toolchain

If your shell does not already have `npm`/`npx`, load Node via `nvm`:

```bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
node -v   # should be 20+
npm -v
```

### 2. Install dependencies and browser binary

```bash
npm install
npx playwright install chromium
```

On Linux hosts without root access, Playwright may fail with missing shared library errors. Install them in user space:

```bash
mkdir -p ~/.cache/pw-debs ~/.local/pw-libs
cd ~/.cache/pw-debs
apt download \
  libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libasound2t64 libxi6 libxrender1
for deb in ./*.deb; do dpkg-deb -x "$deb" ~/.local/pw-libs; done
export LD_LIBRARY_PATH="$HOME/.local/pw-libs/usr/lib/x86_64-linux-gnu:$HOME/.local/pw-libs/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"
```

### 3. Run tests locally

```bash
# Smoke suite only (< 2 min)
npm run test:e2e:smoke

# All tests
npm run test:e2e

# Interactive UI mode
npm run test:e2e:ui

# Headed (watch the browser)
npm run test:e2e:headed

# View last HTML report
npm run test:e2e:report
```

---

## Suite Taxonomy

Tests are tagged in the test title string. Use `--grep` to filter by tag.

| Tag | Description | Runs in CI |
|---|---|---|
| `@smoke` | Fast structural checks — static HTML only, no Firebase required | Every PR |
| `@critical` | Auth, access-control, and routing integration tests | Every PR (Week 2+) |
| `@extended` | Practice, parent workflows, security/isolation | Nightly only |

### Tagging example

```js
test('login happy path @critical', async ({ page }) => { ... });
```

---

## Selector Convention (`data-testid`)

We use `data-testid` attributes as stable handles for Playwright. Rules:

- **Format:** `data-testid="[component]-[element]"` — kebab-case, no abbreviations
- **Examples:** `data-testid="nav-login-btn"`, `data-testid="game-card-title"`, `data-testid="tracker-score-home"`
- **Never** use CSS classes or generated IDs as primary selectors in tests — they change
- **Exception:** Static IDs explicitly intended as stable hooks (e.g., `id="hero-cta"`) are acceptable

### Querying in tests

```js
// Preferred: data-testid
page.locator('[data-testid="nav-login-btn"]')

// Acceptable: stable explicit IDs in static HTML
page.locator('#hero-cta')

// Acceptable: semantic role + accessible name
page.getByRole('button', { name: 'Sign in' })

// Avoid: CSS class selectors
page.locator('.bg-gradient-to-r')  // ❌
```

Add `data-testid` attributes to HTML as you write tests for new flows. The target is to never use a class-based selector in a Playwright spec.

---

## CI Workflows

### `playwright-smoke.yml` — PR gate

- **Trigger:** Every PR to `master`
- **Suite:** `tests/smoke/` (`@smoke` tests)
- **Runtime target:** < 2 minutes
- **On failure:** Uploads HTML report artifact (7-day retention)

PRs are expected to stay green on this gate at all times. If the smoke suite is broken, it blocks merge.

### `playwright-nightly.yml` — Full suite

- **Trigger:** Daily at 03:00 UTC + manual dispatch from Actions tab
- **Suite:** All tests (`npm run test:e2e`)
- **Runtime target:** < 30 minutes
- **Artifacts:** HTML report always uploaded (30-day retention); traces uploaded on failure (14-day)

The nightly run produces the evidence log used to track pass/fail trends and flake rate.

---

## Firebase Emulator (Week 2 — Days 3+)

Auth and Firestore-dependent integration tests require the Firebase Emulator. This is **not yet wired** in CI — spike required by Day 2 (2026-02-24).

### Planned CI step (to be added)

```yaml
- name: Start Firebase Emulator
  run: npx firebase emulators:start --only auth,firestore &
  env:
    FIREBASE_TOKEN: ${{ secrets.FIREBASE_TOKEN }}

- name: Wait for emulator
  run: npx wait-on http://127.0.0.1:9099 http://127.0.0.1:8080 --timeout 30000
```

Seed script pattern: `_migration/seed-test-fixtures.js` (to be created on Day 2).

---

## Smoke Test: What Is and Isn't Tested

The smoke suite (`tests/smoke/`) only asserts on **static HTML** content that is present before any JavaScript or Firebase code runs. It does **not** test:

- Elements injected by `checkAuth()` or `renderHeader()` (these depend on Firebase Auth resolving)
- Dynamic game lists loaded from Firestore
- Any authenticated state

The `@critical` suite (Week 1, Days 3-4) will cover auth and role-gated UI — against the Firebase Emulator.

---

## Flake Management

- Flake rate target: < 2% per spec
- Flaky specs are tagged `@quarantine` and moved to a separate folder (`tests/quarantine/`) until fixed
- Nightly CI does **not** run quarantine specs
- Flake triage is Day 9 (2026-03-05) work

---

## Artifact Access

All workflow runs store HTML reports as GitHub Actions artifacts:

1. Go to **Actions** tab in the repo
2. Select the workflow run
3. Scroll to **Artifacts** — download `playwright-*-report-<run_id>`
4. Open `index.html` in the downloaded folder
