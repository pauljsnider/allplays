# Game Flow

A static HTML + JavaScript sports team management and stat tracking application, powered by Firebase.

## Features

- **Team Management**: Create and manage multiple teams.
- **Roster Management**: Add players with names and numbers.
- **Schedule**: Manage upcoming games and past results.
- **Live Stat Tracking**: Track stats live during games with a mobile-friendly interface.
- **Match Reports**: View detailed summaries and aggregated stats for completed games.
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

## Folder Structure

- `index.html`: Public home page.
- `dashboard.html`: User dashboard (protected).
- `team.html`: Public team details.
- `game.html`: Match report.
- `track.html`: Live tracking interface.
- `js/`: Shared JavaScript modules.
- `css/`: Global styles.
- `assets/`: Images and static assets.
- `img/`: Favicons and logos.
