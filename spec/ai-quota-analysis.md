# AI Quota Analysis — Gemini 2.5 Flash

**Date:** 2026-02-24
**Model:** `gemini-2.5-flash`
**Firebase Project:** `game-flow-c6311` (Spark / free plan)

---

## Problem

The app was hitting 429 `RESOURCE_EXHAUSTED` errors from `firebasevertexai.googleapis.com`.

**Root cause:** The Gemini Developer API free tier limit for `gemini-2.5-flash` was reduced to **20 requests/day** on December 7, 2025. This is a daily quota (resets midnight Pacific Time), not a per-minute rate limit — so once exhausted it stays broken for hours.

**Exact quota ID:** `GenerateRequestsPerDayPerProjectPerModel-FreeTier`
**Limit:** 20 requests/day (free tier)

---

## Code Fix Applied

`game-day.html` — Removed auto-firing `generateCoachFocus()` on page load in pregame mode. Every coach/admin opening the Game Day Command Center was burning a quota request automatically. The refresh button still works on-demand.

```js
// REMOVED — was auto-firing on every pregame page load:
if (state.mode === 'pregame') {
    setTimeout(() => generateCoachFocus(), 800);
}
```

---

## AI Usage in the Codebase

| File | Trigger | Notes |
|---|---|---|
| `game-day.html` | On-demand (button) | Fixed — was auto-firing on load |
| `team-chat.html` | `@ALL PLAYS` mention | 2 calls per mention (router + answer) |
| `js/live-game.js` | `@all plays` in game chat | User-initiated |
| `js/live-tracker.js` | Button click | User-initiated |
| `js/track-basketball.js` | Button click | User-initiated |

---

## Actual Usage (Last 30 Days: Jan 24 – Feb 23, 2026)

### Requests by Response Code

| Code | Count |
|---|---|
| 200 (success) | 119 |
| 429 (quota exceeded) | 33 |
| 400 (bad request) | 2 |
| 403 (forbidden) | 1 |
| **Total** | **155** |

### Token Usage

| Token Type | Tokens |
|---|---|
| Input | 344,121 |
| Output | 36,188 |
| Thinking | 160,819 |
| **Total** | **541,128** |

---

## Blaze Plan Cost Estimate

Based on actual 30-day usage above at Gemini 2.5 Flash pay-as-you-go pricing:

| Token Type | Tokens | Rate | Cost |
|---|---|---|---|
| Input | 344,121 | $0.075 / 1M | $0.026 |
| Output | 36,188 | $0.30 / 1M | $0.011 |
| Thinking | 160,819 | $3.50 / 1M | $0.563 |
| **Total** | | | **~$0.60/month** |

Thinking tokens account for ~94% of cost. Upgrading to Blaze would cost under $1/month at current usage and remove the 20 req/day cap entirely.

---

## Previous Period (Dec 25, 2025 – Jan 24, 2026)

| Token Type | Tokens |
|---|---|
| Input | 79,966 |
| Output | 27,844 |
| Thinking | 86,892 |
| Estimated cost | ~$0.44 |

Usage increased ~2.4× month-over-month, likely due to the Game Day Command Center launch and its auto-firing behavior (now fixed).
