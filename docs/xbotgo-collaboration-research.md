# XbotGo x ALL PLAYS Collaboration Research

## ALL PLAYS: Main Features

ALL PLAYS is a sports team management and live stat tracking web app built on Firebase, targeting youth and club sports.

### Core Capabilities

1. **Team & Roster Management** -- Create teams, manage player rosters with photos/numbers/positions, bulk import players, and define sport-specific stat configurations.

2. **Live Stat Tracking** -- Mobile-first stat entry during games. A basketball-optimized tracker supports substitutions, playing time fairness, game clock, foul tracking, and opponent stat tracking. A standard tracker handles all other sports.

3. **Live Game Broadcasting** -- Real-time play-by-play, scoreboard, and stats pushed to spectators via Firebase. Viewers need no login. Includes live chat, emoji reactions, viewer count, and an AI chat assistant that answers questions about the game using live stats and recent history.

4. **Game Replay** -- Completed live games can be replayed at variable speed (1x-4x) with events, chat, reactions, and score all recreating the experience.

5. **AI-Powered Game Summaries** -- Vertex AI generates narrative game recaps from stat data, delivered in-app and via email.

6. **Parent Engagement** -- Parents are invited by coaches, get their own dashboard, see their child's stats, access team chat, and watch live games/replays.

7. **Team Chat** -- Persistent messaging for coaches, admins, and parents with edit/delete, moderation, and AI assistant integration.

8. **Game Reporting & Analytics** -- Post-game stat tables, sortable by category, with linked opponent data and AI summaries.

9. **Multi-Sport Support** -- Configurable stat columns per sport. Basketball has a dedicated optimized tracker; other sports use the general tracker.

10. **Access-Controlled Roles** -- Global admins, team owners, team admins, and parents each have scoped permissions enforced via Firestore security rules.

### AI-Powered Data Entry (Gemini 2.5 Flash)

ALL PLAYS uses Google's Gemini 2.5 Flash model through Firebase Vertex AI across five major AI capabilities. The core idea: coaches shouldn't have to manually type in data that already exists on a printed sheet, a screenshot, or a block of text.

#### AI Roster Import ("Bulk AI Update")

Coaches can create entire rosters by uploading a photo or pasting raw text:

- **Image input**: Take a photo of a printed roster sheet, a SquadLocker order, a league registration printout, or a screenshot from any source. The AI extracts player names and jersey numbers from the image.
- **Text input**: Paste raw text in any format -- "#12 Sarah Jones G", "Smith, Avery - 4", comma-separated lists, tab-delimited spreadsheets, or freeform paragraphs. The AI parses names and numbers regardless of format.
- **Combined input**: Upload an image AND add text instructions like "only keep the A team players" or "ignore the coaches listed at the bottom."
- **Smart operations**: The AI proposes add, update, or delete operations with a preview. It matches incoming data against the existing roster to avoid duplicates, handles various number formats (#10, 10, "Number: 10"), and automatically skips headers, team names, and non-player text.
- **Human review**: Every proposed change is shown in an editable preview before applying. Coaches can modify names, numbers, or skip individual changes.

#### AI Schedule Import ("Bulk AI Update")

Same concept applied to game schedules:

- **Image input**: Photograph a printed season schedule, a league-issued PDF, or a whiteboard with game dates. The AI reads dates, opponents, locations, and times.
- **Text input**: Paste schedule text in any format. The AI handles "Sat 11/22 vs Eagles @ Home 2:30 PM", "11/15 - Tigers - Away", or any other layout.
- **Smart date parsing**: Converts partial dates ("11/15", "Sat Nov 22") to full ISO 8601 dates, intelligently infers the year based on the current date.
- **Conflict detection**: Warns if a proposed game falls within 24 hours of an existing scheduled game.
- **Editable preview**: Every parsed game is shown with editable date, opponent, and location fields before committing.

#### AI Stat Sheet Analysis ("Analyze Photo")

For post-game data entry from official scoresheets:

- **Input**: Photo of an official basketball scoresheet (the paper form referees fill out).
- **Extraction**: The AI reads both teams' data including player numbers, names, individual foul counts (clamped to 0-5), scoring by half/overtime, and final scores.
- **Roster matching**: Automatically matches parsed players to the team's existing roster by jersey number first, then by name. If the visitor column matches the roster better than the home column, it auto-swaps.
- **Structured output**: Returns a complete JSON game record with metadata (date, time, location, coaches) and full player stat lines for both teams.

#### AI Game Summaries

- **Trigger**: Generated when a coach taps "Save & Complete" after tracking a game.
- **Context**: Receives final score, opponent name, full player stats, key events, and sport type.
- **Output**: A narrative game recap written in sports reporter style (e.g., "The Eagles dominated the paint in the second half, outscoring the Tigers 18-8 behind a 14-point performance from #23 Smith...").
- **Delivery**: Displayed on the game report page and included in email summary drafts.

#### AI Chat Assistant (@ALL PLAYS)

- **Trigger**: Mention @ALL PLAYS in live game chat or team chat.
- **Context**: Has access to current game stats, play-by-play events, team roster, and the last 10 completed games of historical data.
- **Output**: Answers questions about the game in real-time (e.g., "Who has the most rebounds?" or "How does this compare to last game?").

### Sports Support

| Sport | Tracker | Status | Stat Columns |
|-------|---------|--------|-------------|
| **Basketball** | Dedicated mobile-optimized tracker + standard | Production | Points, rebounds, assists, steals, turnovers, fouls, substitutions, playing time |
| **Soccer** | Standard tracker | Production | Goals, shots, passes, blocks, hustle |
| **Custom** | Standard tracker | Production | User-defined columns (any sport) |
| **Cheer** | Beta mobile tracker | Beta | Experimental scoring categories |

The **Custom** sport type means ANY sport can be tracked -- football, baseball, lacrosse, volleyball, hockey, etc. -- by defining the relevant stat columns. Basketball gets the premium treatment with its own mobile-optimized tracker, substitution management, and AI stat sheet analysis. Soccer has a predefined template. Everything else uses the flexible custom configuration.

---

## XbotGo: Overview

XbotGo is an AI-powered sports camera system (hardware + app) that auto-tracks the ball and players, eliminating the need to manually film games.

### Products

| Product | Description | Price |
|---------|-------------|-------|
| **Chameleon** (current) | AI phone mount, 360-degree rotation, 4K via phone, xbotVision AI 2.0 | ~$329-$350 |
| **Falcon** (shipping Mar 2026) | Standalone 4K camera, Sony sensor, IP55 weatherproof, 4hr battery, no phone needed | ~$599 |

### Key Capabilities

- **20+ sports** supported (soccer, basketball, football, lacrosse, hockey, tennis, etc.)
- **AI auto-tracking** with 95% accuracy, jersey number recognition
- **4K recording** and **live streaming** to YouTube, Facebook, or any RTMP endpoint
- **AI highlight generation** (basketball-specific auto-editing; manual markers for other sports)
- **20GB free cloud storage**, no subscription fees
- **ScoreSync** -- live score overlay on recordings
- **GameChanger integration** via RTMP streaming

### Market Position

- **Zero subscription fees** (one-time hardware purchase) vs. Veo ($1,199+ plus subscription), Pixellot ($949+ plus $69-167/mo), Trace (leased + subscription)
- **150,000+ users** across coaches, parents, and athletes
- **Target market**: Youth/club sports -- same demographic as ALL PLAYS
- **No public API or SDK** currently available
- **Self-contained ecosystem** with limited third-party integrations

---

## Why Collaboration Makes Sense

### Complementary Strengths

| Capability | ALL PLAYS | XbotGo |
|-----------|-----------|--------|
| Live stat tracking | Yes | No |
| AI game filming | No | Yes |
| Play-by-play data | Yes (structured events) | No (video only) |
| Video recording | No | Yes (4K) |
| Live streaming | Stats/scoreboard only | Video via RTMP |
| AI highlights | No | Yes (basketball) |
| AI game summaries | Yes (text narrative) | No |
| Team/roster management | Yes | No |
| Parent engagement tools | Yes | No |
| Subscription model | Free (Firebase costs) | Free (no subscription) |

The two products address completely different halves of the youth sports experience: **ALL PLAYS handles data** (stats, rosters, scheduling, communication) while **XbotGo handles video** (filming, streaming, highlights). Neither competes with the other.

### Shared Target Market

Both products target the same users:
- **Parents** who want to follow their kids' games
- **Coaches** managing youth/club teams
- **Youth sports organizations** running leagues and tournaments

Both also share a "no subscription" philosophy that appeals to cost-conscious sports families.

---

## Collaboration Opportunities

### 1. Stat-Synced Video Highlights

**Concept**: Use ALL PLAYS stat events (timestamps, player IDs, event types) to auto-generate highlight clips from XbotGo video.

**How it works**:
- ALL PLAYS tracker records events with game clock timestamps (e.g., "Q2 3:42 -- #23 Smith 3pt shot")
- XbotGo records video of the same game with its own timeline
- Post-game, sync the timelines and extract video clips at each stat event
- Result: Every basket, steal, block, or key play has a corresponding video clip

**Value**: Parents get video of their kid's specific plays. Coaches get film tagged to actual stats. Players get recruiting highlight reels with stats overlaid.

### 2. Enhanced Live Streaming

**Concept**: Overlay ALL PLAYS live stat data onto XbotGo's video stream.

**How it works**:
- XbotGo streams video via RTMP
- ALL PLAYS live tracker broadcasts stats in real-time via Firebase
- A combined viewer shows the video stream with a live scoreboard, stat ticker, and play-by-play feed
- ALL PLAYS already has the live viewer UI (`live-game.html`) -- adding a video embed panel would create a full broadcast experience

**Value**: Transforms a youth game into a broadcast-quality experience with video + stats + chat + reactions, all free.

### 3. AI Game Recap with Video

**Concept**: Combine ALL PLAYS AI game summaries with XbotGo AI-generated highlights.

**How it works**:
- ALL PLAYS generates a text narrative recap from structured stat data
- XbotGo generates a highlight reel from video
- Together: a shareable game recap page with written summary, stat table, and embedded highlight video

**Value**: Parents who missed the game get the complete picture. Coaches share professional-looking game reports.

### 4. Jersey Number Sync

**Concept**: XbotGo's jersey number recognition could feed player identification back to ALL PLAYS.

**How it works**:
- ALL PLAYS roster has player names, numbers, and photos
- XbotGo's AI identifies jersey numbers during filming
- Map XbotGo's jersey detections to ALL PLAYS roster data
- Enable automatic stat attribution: "Camera sees #23 score" could pre-populate stat entry

**Value**: Reduces stat keeper workload. Moves toward automated stat tracking from video.

### 5. Cross-Promotion and Bundling

**Concept**: Mutual referral or bundled offering.

**How it works**:
- XbotGo's app/website recommends ALL PLAYS for stat tracking
- ALL PLAYS recommends XbotGo as the filming solution
- Potential bundle: "Film + Track your games" package
- XbotGo's 150,000+ user base gets exposure to ALL PLAYS; ALL PLAYS users discover XbotGo

**Value**: User acquisition for both products at zero marginal cost.

### 6. Unified Parent Experience

**Concept**: Single destination for parents to see their child's game -- video, stats, chat.

**How it works**:
- ALL PLAYS parent dashboard already shows linked players, stats, and team chat
- Add XbotGo video integration: game recordings and highlights accessible from ALL PLAYS
- Parent gets one place to check scores, watch highlights, read the AI recap, and chat with the team

**Value**: Solves the "fragmented sports parent" problem where video is in one app, stats in another, and communication in a third.

---

## Technical Integration Paths

### Near-Term (No API Required)

1. **RTMP Link Sharing** -- ALL PLAYS schedule page could store and share the XbotGo RTMP stream URL, making it easy for the stat keeper and camera operator to coordinate.

2. **Video Embed** -- After XbotGo uploads to their cloud or YouTube, ALL PLAYS game report page could embed the video link alongside stats. This requires only a URL field on the game document.

3. **Timestamp Export** -- ALL PLAYS could export stat events with game clock timestamps in a format XbotGo could import for highlight clipping. A simple JSON/CSV export from the events collection.

### Medium-Term (Requires XbotGo Cooperation)

4. **Deep Link Integration** -- XbotGo app opens ALL PLAYS game page (and vice versa) with shared game identifiers.

5. **Shared Cloud Storage** -- XbotGo video clips stored alongside ALL PLAYS game data, accessible from the game report.

6. **Score Overlay Feed** -- ALL PLAYS live score data fed into XbotGo's ScoreSync feature for accurate, real-time score overlays on video.

### Long-Term (Requires API/SDK)

7. **Bidirectional Data Sync** -- XbotGo's jersey tracking data flows into ALL PLAYS for semi-automated stat entry. ALL PLAYS stat events flow into XbotGo for smart highlight clipping.

8. **Unified SDK** -- Shared authentication, team/roster sync, and event bus between the two platforms.

---

## Risks and Considerations

- **No public XbotGo API**: The biggest technical barrier. All deeper integrations require XbotGo to expose data or accept data from external systems. Near-term opportunities (embed links, RTMP coordination) work around this.
- **Different platforms**: ALL PLAYS is web-based; XbotGo is a native mobile app. Integration likely needs to happen at the data/cloud layer rather than UI layer.
- **Basketball bias**: XbotGo's AI auto-editing is currently basketball-only, which aligns well with ALL PLAYS' basketball-optimized tracker but limits multi-sport synergy initially.
- **Coordination overhead**: Two separate people often handle filming and stat tracking at youth games (one parent with the camera, another keeping stats). Integration needs to be seamless enough that coordination isn't a burden.
- **Market overlap**: Both target the same demographic, which is good for user acquisition but means they need to avoid stepping on each other's roadmaps.

---

## Recommendation

The most compelling near-term collaboration is **embedding XbotGo video alongside ALL PLAYS game reports and live broadcasts**. This requires no API -- just a video URL field on the game document and an embed panel in the live viewer and game report pages. It immediately delivers the "one place for everything" experience parents want.

The highest-impact long-term opportunity is **stat-synced video highlights** -- using ALL PLAYS' structured play-by-play data to automatically clip and tag XbotGo video. This is a differentiator no competitor offers today and would be genuinely transformative for youth sports families.

Both products share the same market, the same "no subscription" philosophy, and complementary feature sets. A partnership would make each product significantly more valuable without requiring either to build capabilities outside their core expertise.

---

## Outreach Email Draft

**To:** XbotGo Team / Partnerships
**Subject:** Collaboration idea -- AI stat tracking + AI camera for youth sports

---

Hi XbotGo team,

I'm Paul Snider, the creator of ALL PLAYS (allplays.app) -- a free web app for youth sports team management and live stat tracking. By day I'm a CTO in healthcare, but I built ALL PLAYS as a passion project while coaching my daughter's basketball team. I got tired of scribbling stats on paper and wanted something better for our team, so I built it.

I've been following what you're doing with XbotGo and I think there's a really natural fit between our two products. Here's the short version:

**What ALL PLAYS does:**
- Live stat tracking from your phone during games (basketball-optimized with subs, playing time, fouls -- plus a configurable tracker for soccer, football, and any other sport)
- AI-powered data entry -- coaches can snap a photo of a printed roster, a season schedule, or an official scoresheet and our AI (Gemini 2.5 Flash) extracts all the data automatically. No manual typing.
- Live game broadcasting -- parents and fans get real-time scoreboard, play-by-play, live chat, emoji reactions, and an AI assistant that answers questions about the game ("Who has the most points?") all without needing to log in
- Game replay at variable speed so parents who missed the game can watch it unfold
- AI-generated game summaries written in sports reporter style
- Team chat, parent dashboards, roster management -- the whole team management layer
- Completely free, no subscriptions

**What XbotGo does (that we don't):**
- AI-powered autonomous filming -- the part we can't touch
- 4K video recording and live streaming
- AI highlight reels
- Jersey number recognition

**Where I see the opportunity:**

You handle the video side brilliantly. We handle the data side. Together we could give youth sports families something nobody else offers:

1. **Stat-synced highlights** -- Our tracker records timestamped events (e.g., "Q2 3:42 -- #23 Smith 3-pointer"). Your camera records the video. Sync the timelines post-game and every key play has a video clip attached. Parents get highlight reels of their kid's actual stat moments.

2. **Live broadcast with video + stats** -- Your RTMP stream plus our real-time scoreboard, play-by-play, and live chat. A youth basketball game gets the ESPN treatment for free.

3. **ScoreSync integration** -- Our live score data could feed directly into your ScoreSync overlay so the score on the video is always accurate and automatic.

4. **Jersey number to roster mapping** -- Your AI recognizes jersey numbers, we have the roster data. That's the foundation for semi-automated stat tracking from video.

5. **AI photo of a scoresheet to game stats** -- We already do this. Imagine pairing it with your AI-edited game video for a complete post-game package.

I'm not a company trying to sell you something -- I'm a sports dad who builds software and thinks our two projects would be better together. ALL PLAYS is open source, free, and built for the same families you serve.

Would love to hop on a call or trade emails about what a collaboration could look like. Even something simple like embedding XbotGo video links in our game reports would be a win for both of our users.

Best,
Paul Snider
Creator, ALL PLAYS
CTO, [Healthcare Company]

---

*P.S. -- If you want to see ALL PLAYS in action, the live game viewer works without any login. Happy to set up a demo game you can watch in real-time.*
