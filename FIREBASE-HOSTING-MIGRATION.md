# GitHub Pages → Firebase Hosting cutover runbook

Goal: serve `allplays.ai` from Firebase Hosting so the GitHub repo can be made private without taking the site down.

## Current state

- `deploy-prod.yml` already deploys the full site (legacy root + `/app/` + Functions + Firestore rules/indexes) to Firebase Hosting on `game-flow-c6311` on every push to `master`. The Firebase copy at <https://game-flow-c6311.web.app> stays current automatically.
- `allplays.ai` DNS still points at GitHub Pages (A records `185.199.108-111.153`, `www` CNAME to `pauljsnider.github.io`).
- GitHub Pages deploys are gated by the repo Actions variable `APP_GITHUB_PAGES_DEPLOY_ENABLED` (in `app-github-pages.yml`).
- A `firebase=game-flow-c6311` TXT record already exists on the domain for Firebase domain verification.

## Cutover steps (manual, in order)

1. **Firebase console**: Hosting → Add custom domain for `allplays.ai` and `www.allplays.ai` on the `game-flow-c6311` site. Domain verification should pass via the existing TXT record.
2. **DNS registrar**: replace the four GitHub Pages A records on `allplays.ai` with the A record(s) Firebase provides, and repoint the `www` CNAME to the Firebase target.
3. **Wait for SSL**: Firebase provisions the certificate (minutes up to ~1 hour). Verify with:
   ```bash
   curl -sI https://allplays.ai/ | grep -i server   # should no longer say GitHub.com
   ```
4. **Verify the site**: `https://allplays.ai/`, `https://allplays.ai/app/`, sign-in, and a public RSVP page.
5. **Disable Pages deploys**: set the repo Actions variable `APP_GITHUB_PAGES_DEPLOY_ENABLED` to `false`, then disable Pages in repo Settings → Pages.
6. **Post-cutover repo cleanup** (separate PR): delete `CNAME`, remove the `deploy` job from `.github/workflows/app-github-pages.yml` (keep the bundle build/size-check job or fold it into `ci.yml`).
7. **Firebase Auth cleanup**: remove `pauljsnider.github.io` from Authentication → Settings → Authorized domains.

## Making the repo private (after cutover)

- **Actions billing**: private repos on the Free plan include 2,000 minutes/month; beyond that Linux is $0.008/min and macOS is 10× ($0.08/min). Current CI cadence (~100 runs/day, `scheduled-prod-smoke` every 15 min, `ios-simulator` on `macos-15`) would far exceed the free tier. Mitigations: relax the smoke schedule, gate the macOS job harder, or use a self-hosted runner.
- **Access**: re-grant any GitHub Apps/bots (PR reviewers) and collaborators access to the private repo.
- **Side effects**: the repo's public forks are detached, README badges stop rendering publicly, and issue links become owner-only.
