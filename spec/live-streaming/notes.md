# Live Streaming — Research Notes

**Status:** Research complete. Next step: implement Twitch as Phase 1.
**Last updated:** 2026-03-01

---

## The Problem

Browsers cannot speak RTMP (the protocol streaming platforms require). This means going live from the ALL PLAYS web app always needs either:
- A server in the middle (browser → WebSocket → server → RTMP → platform), OR
- Handing off to a native app (YouTube app, OBS, Streamlabs, etc.)

ALL PLAYS is a static GitHub Pages app (`allplays.ai`). No backend today.

---

## Platform Comparison

### Social Platforms

| Platform | Go Live Requirement | RTMP Support | Embeddable | Notes |
|---|---|---|---|---|
| **Twitch** | **None** | ✅ | ✅ (`parent` param) | Best option — zero barrier |
| **YouTube** | 50 subs (mobile only) | ✅ bypasses it | ✅ iframe | Already built for viewer side |
| **Facebook Live** | **None** | ✅ | ✅ (login sometimes required) | Parents likely have accounts |
| Instagram Live | 1,000 followers | ❌ | ❌ | Not viable |
| TikTok Live | 1,000 followers | ❌ | ❌ | Not viable |

### Managed / Infrastructure Services

| Service | Cost | Follower Req | Latency | Notes |
|---|---|---|---|---|
| **AWS IVS** | ~$0.002/min streamed | None | <3s | Twitch-built tech, lowest latency, best long-term |
| **Mux** | ~$0.006/min | None | ~5–10s | Best developer SDK, WebRTC built-in |
| **Cloudflare Stream** | $1/1,000 min delivered | None | ~10s | Simple pricing, already in Cloudflare ecosystem |
| Dacast / BoxCast | $25–100/mo flat | None | ~10s | Sports-focused, white-label |

---

## Why Twitch Wins for Phase 1 (Free / No Requirements)

- **Zero follower/subscriber requirement** — anyone can stream immediately
- **Free** — no cost to stream or embed
- **RTMP support** — bypasses any mobile restrictions, no platform subscriber checks
- **Embeddable via iframe** — confirmed via Twitch Developer docs
- **`parent` domain requirement** — must match host domain. Ours is `allplays.ai`. ✅
- **HTTPS required** — GitHub Pages + custom domain = HTTPS. ✅
- **Localhost works** — `parent=localhost` accepted for dev/testing. ✅

### Twitch Embed Format
```html
<iframe
  src="https://player.twitch.tv/?channel=CHANNEL_NAME&parent=allplays.ai"
  frameborder="0"
  allowfullscreen
  width="100%"
  height="100%">
</iframe>
```

The `channel` value = the Twitch username the team sets up. Stored on the team doc same as `youtubeEmbedUrl`.

### Known Twitch Limitations
- Stream is public — anyone on Twitch can find it
- Branding is Twitch (purple, Twitch logo in player)
- Coach needs a Twitch account and stream key
- No private/unlisted streams on free tier

---

## Going Live — What the Coach Does Today (Before We Build Anything)

1. Create a free Twitch account at twitch.tv
2. Get stream key: Twitch Dashboard → Settings → Stream → Primary Stream Key
3. Download a free RTMP app: **Streamlabs** (mobile) or **OBS** (desktop)
4. Paste stream key into the app, go live
5. Paste their Twitch channel URL into ALL PLAYS team settings
6. ALL PLAYS embeds the stream for fans automatically during live games

No server needed. No follower count. No cost.

---

## Long-Term Path (When We Want "Go Live" Button in the App)

Going live from the browser requires a server for WebRTC → RTMP transcoding.

### Recommended Architecture
```
Phone Camera
  ↓
Browser (getUserMedia + MediaRecorder)
  ↓  WebSocket chunks
Server (Node + FFmpeg)  ← EC2 t3.small ~$15/mo OR Google Cloud Run
  ↓  RTMP
Twitch / YouTube / Facebook / AWS IVS
  ↓
Fans watch in ALL PLAYS (embedded iframe)
```

### Server Options
| Option | Cost | Complexity | Notes |
|---|---|---|---|
| EC2 t3.small + NGINX-RTMP | ~$15/mo | Medium | Always-on, handles multiple streams |
| Google Cloud Run + FFmpeg | Pay-per-use | Medium | Stays in Firebase ecosystem |
| AWS IVS (fully managed) | ~$0.002/min | Low | Purpose-built, handles everything |
| Mux | ~$0.006/min | Very Low | Best SDK, easiest to integrate |

### Firebase Cloud Functions — NOT viable for streaming
Cloud Functions time out (max ~9 min). A live game runs 1–2 hours. Not suitable for long-running RTMP processes.

---

## Multi-Platform Option (Future)

Coach picks destination when going live:
- ALL PLAYS Native (AWS IVS / Mux) — private, branded
- YouTube — public, familiar
- Twitch — public, free
- Facebook — public, parents likely have accounts

All use the same server/browser pipeline. Only the RTMP destination URL changes.

---

## What's Already Built

- `team.youtubeEmbedUrl` field on team doc — stores embed URL (supports video ID and channel ID)
- `setupVideoPanel()` in `live-game.js` — shows/hides video panel based on team data
- YouTube live stream embed in `live-game.html` — 3-column desktop layout (plays | video | stats)
- Team settings field in `edit-team.html` — paste any YouTube URL or channel ID

## What Needs to Be Built for Twitch (Phase 1)

- Add `twitchChannel` field to team doc (just the username string)
- Update `edit-team.html` to accept a Twitch channel URL/username
- Update `setupVideoPanel()` to generate correct embed URL for Twitch vs YouTube
- `parent=allplays.ai` must be in the Twitch embed URL

---

## References

- [Twitch Embedding Docs](https://dev.twitch.tv/docs/embed/)
- [YouTube Live Streaming API](https://developers.google.com/youtube/v3/live/getting-started)
- [Mux: State of Going Live from Browser](https://www.mux.com/blog/the-state-of-going-live-from-a-browser)
- [AWS IVS Alternatives](https://getstream.io/blog/amazon-ivs-alternatives/)
- [Live Streaming Requirements by Platform](https://switchboard.live/blog/live-streaming-requirements-for-going-live-on-social-platforms)
- [RTMP Bypasses YouTube Mobile Subscriber Limit](https://ottverse.com/stream-to-youtube-live-from-mobile-without-1000-subscribers/)
