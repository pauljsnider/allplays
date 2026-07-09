# Game Flow

A static HTML + JavaScript sports team management and stat tracking application, powered by Firebase.

## Features

- **Team Management**: Create and manage multiple teams.
- **Roster Management**: Add players with names and numbers.
- **Schedule**: Manage upcoming games and past results.
- **Practice Planning**: Build event-specific practice plans from `edit-schedule.html` with a dedicated Practice Command Center (`drills.html`).
- **Drill Library**: Browse community drills, create/edit team drills, favorite drills, and publish team drills to community.
- **Practice AI Coach**: Use ALL PLAYS COACH chat for attendance-aware planning and timeline recommendations.
- **Practice Attendance & Notes**: Track present/late/absent players, capture quick/voice notes, and persist by practice session.
- **Home Packet Workflow**: Create take-home drill packets from practice plans and track parent completion per player.
- **Live Stat Tracking**: Track stats live during games with a mobile-friendly interface.
- **Match Reports**: View detailed summaries and aggregated stats for completed games.
- **Linked Opponents**: Link opponent teams to preload their roster in the live tracker and show logos/photos in reports.
- **Parent Workflow**: Invite parents to players, view parent-only dashboards, and allow limited profile edits.
- **Admin Dashboard**: Comprehensive admin section for user and data management (restricted access).
- **Public/Private Teams**: Control team visibility in the public directory.
- **Email Summaries**: Generate a mailto draft of the game summary from the tracker UI (no backend send).

## Tech Stack

- **Frontend**: Pure HTML, JavaScript (ES Modules), Tailwind CSS (CDN).
- **Backend**: Firebase (Auth, Firestore, Storage).
- **Hosting**: Firebase Hosting (or any static host).

## Setup & Deployment

### 1. Firebase Setup

1. Create a new Firebase project at [console.firebase.google.com](https://console.firebase.google.com/).
2. Enable **Authentication** (Email/Password provider).
3. Enable **Firestore Database** (Start in production mode, set appropriate rules).
4. Enable **Storage** (For team photos).
5. Configure Firebase web settings at runtime (do not hardcode credentials in source):
   - Main app config: `window.__ALLPLAYS_CONFIG__.firebase` (or `firebasePrimary`) with keys `apiKey`, `authDomain`, `projectId`, `messagingSenderId`, `appId` (optional: `storageBucket`, `measurementId`).
   - Image app config: `window.__ALLPLAYS_CONFIG__.firebaseImages` (or `firebaseImage`) with the same keys.
   - On Firebase Hosting, primary config can also come from `/__/firebase/init.json`.

Notes:
- Auth domains must include your hosting domains and local dev (e.g., `localhost`, `127.0.0.1`, `allplays.ai`, `game-flow-c6311.web.app`).
- Email summaries are mailto-only; there is no backend email send.
- AI match summary in `track.html` requires Firebase AI enabled/billing; hide it if disabled.

### 1.1 Stripe Team Pass configuration

Team Pass checkout is handled by Firebase Functions and Stripe. Do not commit Stripe secrets.

Required function configuration or environment variables:
- `STRIPE_SECRET_KEY` or `stripe.secret_key` — Stripe restricted/secret API key used by Cloud Functions.
- `STRIPE_WEBHOOK_SECRET` or `stripe.webhook_secret` — signing secret for the Stripe webhook endpoint.
- `STRIPE_TEAM_PASS_PRICE_ID` or `stripe.team_pass_price_id` — Stripe Price ID for the season Team Pass tier.
- `ALLPLAYS_APP_URL` or `stripe.app_url` — public app URL used for checkout success/cancel redirects. Defaults to `https://allplays.ai`.

Firebase config example:
```bash
firebase functions:config:set \
  stripe.secret_key="sk_live_..." \
  stripe.webhook_secret="whsec_..." \
  stripe.team_pass_price_id="price_..." \
  stripe.app_url="https://allplays.ai"
```

Stripe should send checkout events to:
`https://us-central1-<firebase-project-id>.cloudfunctions.net/stripeTeamPassWebhook`

Only verified `checkout.session.completed` events with paid status create or update team entitlements at `teams/{teamId}/entitlements/{seasonId}_team-pass`.

### 2. Deployment

Production deploys run automatically from `.github/workflows/deploy-prod.yml` on every push to `master`: the workflow stages the site bundle (legacy root plus the React app under `/app/`) and deploys Firebase Hosting, Firestore rules/indexes, and Functions to the `game-flow-c6311` project.

To deploy manually:

```bash
npm run app:build
node scripts/stage-pages-bundle.mjs /tmp/allplays-site
node scripts/write-firebase-hosting-config.mjs /tmp/allplays-site /tmp/firebase-prod.json
npx firebase-tools deploy --only hosting --project game-flow-c6311 --config /tmp/firebase-prod.json
```

See `FIREBASE-HOSTING-MIGRATION.md` for the GitHub Pages → Firebase Hosting cutover runbook.

### 3. Local Development

Since this is a static site, you can run it with any static file server.

Python:
```bash
python3 -m http.server
```

Node (http-server):
```bash
npx http-server .
```

Open `http://localhost:8000` (or port shown) in your browser.

## Admin Setup

To grant admin access to a user:

1. The user must first sign up and create an account
2. In Firestore console, navigate to the `users` collection
3. Find the user document by email
4. Add a field: `isAdmin` (boolean) = `true`

Admin users have access to:
- **Admin Dashboard** at `/admin.html` with full site statistics
- View and manage all teams (edit/delete capabilities)
- View all users
- Admin button in navigation (replaces "Get Started" when signed in)

**Note**: Admin access is enforced through Firestore security rules. The `isAdmin` field is checked server-side for all admin operations.

## Password Reset

Password reset functionality is implemented with Firebase Authentication. If users report not receiving password reset emails:

1. **Check spam/junk folder** - This is where most Firebase emails end up initially
2. Verify Firebase Console email templates are customized (Authentication → Templates)
3. Ensure authorized domains include your deployment URL
4. See [password-reset.md](password-reset.md) for complete troubleshooting guide

The password reset flow:
- User enters email on login page
- Receives email with reset link (check spam!)
- Clicks link → redirected to branded reset-password.html page
- Enters new password → redirected to login

## Security Features

- **Firestore Security Rules**: Multi-level access control with owner, team admin, and global admin permissions
- **Global Admin Functions**: Admins can manage any team or user data
- **Team Privacy**: Teams can be marked as public/private to control visibility
- **Access Code System**: Controlled signup with invitation codes
- **Parent Access Controls**: Parents can view linked players/teams and edit limited player profile fields
- **XSS Protection**: HTML escaping for user-generated content in admin dashboard

## Folder Structure

- `index.html`: Public home page.
- `dashboard.html`: User dashboard (protected).
- `parent-dashboard.html`: Parent dashboard (player-linked schedule filters, practice attendance summaries, home packet completion).
- `admin.html`: Admin dashboard (admin users only).
- `team.html`: Public team details.
- `game.html`: Match report.
- `drills.html`: Practice Command Center (drill library, AI coach chat, practice timeline, attendance, home packet).
- `track.html`: Standard live tracking interface (all sports).
- `track-basketball.html`: Basketball-optimized mobile tracker with subs, queue mode, player photos, AI + email, and Firebase persistence.
- `js/`: Shared JavaScript modules.
- `css/`: Global styles.
- `assets/`: Images and static assets.
- `img/`: Favicons and logos.

## Trackers & Routing

- Games use a stat config (`statTrackerConfigId`) to define sport + columns.
- In `edit-schedule.html`, basketball games (config `baseType: Basketball`, or team sport fallback) prompt on Track:
  - **Standard** → `track.html`
  - **Beta** → `track-basketball.html`
- Non-basketball games always route to `track.html`.
