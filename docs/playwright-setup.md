# Playwright Setup (Local / Non-Root Environment)

This project now includes a Playwright smoke test.

## Objective
Run browser automation locally, even on hosts without root package install access.

## 1. Ensure Node toolchain is available

If your shell does not already have `npm`/`npx`, load Node via `nvm`:

```bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
node -v
npm -v
```

## 2. Install JS dependencies and browser binary

```bash
cd allplays
npm install
npx playwright install chromium
```

## 3. (Non-root hosts only) Install required Linux browser libs in user space

If Playwright fails with missing shared library errors (for example `libatk-1.0.so.0`), run:

```bash
mkdir -p ~/.cache/pw-debs ~/.local/pw-libs
cd ~/.cache/pw-debs
apt download \
  libatk1.0-0t64 \
  libatk-bridge2.0-0t64 \
  libatspi2.0-0t64 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libgbm1 \
  libasound2t64 \
  libxi6 \
  libxrender1
for deb in ./*.deb; do
  dpkg-deb -x "$deb" ~/.local/pw-libs
done
```

Then export:

```bash
export LD_LIBRARY_PATH="$HOME/.local/pw-libs/usr/lib/x86_64-linux-gnu:$HOME/.local/pw-libs/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"
```

## 4. Run tests

Smoke test:

```bash
npm run test:e2e:smoke
```

All tests:

```bash
npm run test:e2e
```

## Included test

- `tests/smoke/homepage.spec.js`: verifies public home page loads and key sections render.
