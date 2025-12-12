# Game Flow

A static HTML + JavaScript sports team management and stat tracking application, powered by Firebase.

## Features

- **Team Management**: Create and manage multiple teams.
- **Roster Management**: Add players with names and numbers.
- **Schedule**: Manage upcoming games and past results.
- **Live Stat Tracking**: Track stats live during games with a mobile-friendly interface.
- **Match Reports**: View detailed summaries and aggregated stats for completed games.
- **Admin Dashboard**: Comprehensive admin section for user and data management (restricted access).
- **Public/Private Teams**: Control team visibility in the public directory.
- **Email Summaries**: Generate a mailto draft of the game summary from the tracker UI (no backend send).

## Tech Stack

- **Frontend**: Pure HTML, JavaScript (ES Modules), Tailwind CSS (CDN).
- **Backend**: Firebase (Auth, Firestore, Storage).
- **Hosting**: GitHub Pages (or any static host).

## Setup & Deployment

### 1. Firebase Setup

1. Create a new Firebase project at [console.firebase.google.com](https://console.firebase.google.com/).
2. Enable **Authentication** (Email/Password provider).
3. Enable **Firestore Database** (Start in production mode, set appropriate rules).
4. Enable **Storage** (For team photos).
5. Copy your web app configuration and update `js/firebase.js` (main project) and `js/firebase-images.js` (image upload project).

Notes:
- Auth domains must include your GitHub Pages host and local dev (e.g., `localhost`, `127.0.0.1`, `pauljsnider.github.io`, custom domain).
- Email summaries are mailto-only; there is no backend email send.
- AI match summary in `track.html` requires Firebase AI enabled/billing; hide it if disabled.

### 2. GitHub Pages Deployment

1. Push this repository to GitHub.
2. Go to **Settings > Pages**.
3. Select the **Source** as `main` branch (or `gh-pages`) and folder `/` (root).
4. Save. Your site will be live at `https://<username>.github.io/<repo-name>/`.

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
- **XSS Protection**: HTML escaping for user-generated content in admin dashboard

## Folder Structure

- `index.html`: Public home page.
- `dashboard.html`: User dashboard (protected).
- `admin.html`: Admin dashboard (admin users only).
- `team.html`: Public team details.
- `game.html`: Match report.
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
