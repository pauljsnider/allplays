# Beta Mock Trackers

This folder contains standalone, in-memory mock UIs for basketball tracking. They are HTML+JS only (no Firebase/auth). Serve them over HTTP (not `file://`) so the ES modules load:

```
cd /Users/paulsnider/allplays
python3 -m http.server 8004 --bind 127.0.0.1
```
Then open the page(s) in a browser:

- `http://127.0.0.1:8004/beta/track-basketball-mock.html`
- `http://127.0.0.1:8004/beta/track-basketball-mobile-mock.html`
- `http://127.0.0.1:8004/beta/sub-tracker-prototype.html`

## Main Site Tracker

The production, Firebase-backed basketball tracker lives at the repo root:
- `track-basketball.html` / `js/track-basketball.js`

It keeps the beta/mobile UX but persists data exactly like `track.html` (events, aggregatedStats, AI summary, email recap).

## Files
- `track-basketball-mock.html` / `js/track-basketball-mock.js`: Desktop-oriented mock of the tracker with in-memory state.
- `track-basketball-mobile-mock.html` / `js/track-basketball-mobile-mock.js`: Mobile-first, data-dense mock with queued subs, bench/lineup management, and opponent quick stats.
- `sub-tracker-prototype.html`: Earlier substitution/playing-time UX prototype (inline JS + Tailwind CDN).

## Notes
- Everything stays local/in-memory; refreshing clears data.
- No build step; served static. Tailwind is from CDN.
- Paths to assets (e.g., `../img/logo_small.png`) assume the repo root when served from `/beta`.
