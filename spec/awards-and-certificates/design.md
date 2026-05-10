# Awards & Certificates Feature Design

## Overview

Awards & Certificates is a team-run workflow, not an individual-certificate workflow. The coach configures the shared certificate setup once, the app selects the active roster by default, AI drafts player-specific descriptions from recent stats, and the coach reviews a grid before saving, publishing, or exporting.

The feature ships as one new page, `certificates.html`, with modules under `js/certificates/`. It is additive and follows existing ALL PLAYS patterns:

- Auth and page shell follow team admin pages such as `team-chat.html` and `team-media.html`.
- Team navigation uses `js/team-admin-banner.js`.
- Firestore access and writes are centralized in `js/db.js`.
- Image uploads use `js/firebase-images.js`, `imageStorage`, `requireImageAuth` / `ensureImageAuth`, `ref`, `uploadBytes`, and `getDownloadURL`.
- AI calls use `js/vendor/firebase-ai.js`, `getApp()`, `getAI(app, { backend: new GoogleAIBackend() })`, and `gemini-2.5-flash`, matching `live-tracker.js`, `track-basketball.js`, and `live-game.js`.

The certificate preview and export use the same rendered DOM. The review grid shows compact per-player rows, while the selected row opens a full certificate preview.

## Primary Coach Flow

1. Coach clicks **Create certificates** or the **Certificates** admin card from the existing team admin experience.
2. `certificates.html#teamId={teamId}` loads team data, certificate defaults, roster, recent completed games, saved runs, and saved certificates.
3. The setup step is mostly prefilled from the team profile and `teams/{teamId}/settings/certificateDefaults`.
4. Coach changes a small set of shared fields:
   - template
   - season label
   - award title
   - color mode
   - foreground/background/watermark images
   - signers
   - description tone
   - stats window, default last 10 completed games with option for last 5
5. Active roster players are selected by default. Coach can deselect players.
6. Coach clicks **Generate team certificates**.
7. The app creates a batch record, creates one draft certificate per selected player, and runs AI description generation per player with bounded concurrency.
8. The coach lands in a review grid with row-level status, quick edits, preview, include/exclude, regenerate, publish, and export controls.
9. Coach publishes/saves all or selected drafts, then downloads selected PNG/PDF exports or a ZIP.

## Architecture

```text
team admin banner / team page action
        |
        v
certificates.html#teamId={teamId}
        |
        v
js/certificates/studio.js
        |
        +--> js/db.js
        |       - teams/{teamId}
        |       - teams/{teamId}/players
        |       - teams/{teamId}/games
        |       - teams/{teamId}/games/{gameId}/aggregatedStats
        |       - teams/{teamId}/settings/certificateDefaults
        |       - teams/{teamId}/certificateBatches
        |       - teams/{teamId}/certificates
        |
        +--> js/certificates/aiDescriptions.js
        |       - Firebase AI, gemini-2.5-flash
        |       - last 5-10 completed games
        |       - public roster fields only
        |
        +--> js/certificates/assets.js
        |       - firebase-images.js image project
        |       - certificate-assets/{teamId}/...
        |       - certificate-signatures/{userId}/...
        |
        +--> js/certificates/templates.js
        +--> js/certificates/renderer.js
        +--> js/certificates/exporter.js
                - html-to-image
                - jspdf
                - jszip
                - certificate-exports/{teamId}/...
```

## Page Layout

### Setup State

The first screen emphasizes the simple team-level setup.

```text
Header
Team Admin Banner, active = certificates

Create certificates
┌────────────────────────────────────────────┬────────────────────────────┐
│ Shared setup                               │ Preview                    │
│ - template                                 │ Selected template with      │
│ - season                                   │ team logo/colors/signers    │
│ - award title                              │ and sample roster player    │
│ - color mode                               │                            │
│ - images                                   │                            │
│ - signers                                  │                            │
│ - description tone                         │                            │
│ - stats window: last 10 / last 5           │                            │
├────────────────────────────────────────────┴────────────────────────────┤
│ Players: all active selected by default                                  │
│ [x] #4 Vivian Karpuk  [x] #7 Emily Clements  ...                         │
│                                                                          │
│ [Generate team certificates]                                             │
└──────────────────────────────────────────────────────────────────────────┘
```

### Review State

After generation, the review grid is the main workspace.

```text
Saved runs        Review generated certificates              Preview
┌────────────┐    ┌──────────────────────────────────────┐   ┌────────────┐
│ Fall 2025  │    │ Player | # | Description | Status    │   │ full cert  │
│ Summer 25  │    │ Vivian | 4 | edit inline | Ready     │   │ preview    │
│ Drafts     │    │ Emily  |22 | edit inline | Needs rev │   │ selected   │
└────────────┘    └──────────────────────────────────────┘   └────────────┘
                  [Regenerate selected] [Publish all]
                  [Export selected] [Download ZIP]
```

On widths below 1024px, setup, player selection, review, and preview stack vertically. The active preview/export actions use sticky controls.

## Module Design

### `js/certificates/studio.js`

Page controller. Responsibilities:

- Parse `teamId`, optional `certificateId`, optional `batchId`, and optional `playerId` from URL params/hash.
- Run auth and access checks.
- Load team, roster, defaults, saved certificates, saved batches, and recent completed games.
- Build default shared setup state.
- Render setup form, player selection, review grid, and preview panel.
- Coordinate batch creation, AI generation, saving, publishing, and export.
- Keep per-player edits local until save/publish actions.

State shape:

```javascript
const state = {
  teamId: null,
  batchId: null,
  team: null,
  roster: [],
  selectedPlayerIds: new Set(),
  mode: 'setup', // setup | generating | review | custom

  shared: {
    templateId: 'banner',
    teamNameOverride: null,
    awardTitle: '',
    seasonLabel: '',
    footerUrl: '',
    colorMode: 'team',
    customColors: {
      borderColor: '#dc2626',
      accentColor: '#1e3a8a',
      textColor: '#0f172a'
    },
    descriptionTone: 'celebratory and specific',
    statsWindow: 10,
    signers: [],
    foregroundImageRef: null,
    backgroundImageRef: null,
    watermarkImageRef: null,
    watermarkOpacity: 12
  },

  draftsByPlayerId: new Map(), // playerId -> draft state
  selectedDraftId: null
};
```

Draft state:

```javascript
{
  certificateId: null,
  batchId: null,
  playerId: 'player_123',
  recipientName: 'Vivian Karpuk',
  playerNumber: '4',
  playerPhotoUrl: 'https://...',
  awardTitle: 'Most Improved',
  description: '',
  descriptionSource: 'ai', // ai | manual | fallback
  descriptionStatus: 'pending', // pending | ready | needs-review | error
  statsWindow: 10,
  includeInExport: true,
  errorMessage: null,
  status: 'draft'
}
```

### `js/certificates/templates.js`

Declarative registry of certificate templates. Each template renders the same shared setup with one draft.

```javascript
export const TEMPLATES = {
  banner: {
    id: 'banner',
    displayName: 'Banner',
    thumbnailUrl: 'img/cert-thumb-banner.png',
    aspect: { width: 2050, height: 1080 },
    colorSlots: ['borderColor', 'accentColor', 'textColor'],
    variables: [
      'teamName',
      'recipientName',
      'playerNumber',
      'awardTitle',
      'description',
      'seasonLabel',
      'signers',
      'foregroundImage',
      'watermarkImage',
      'footerUrl'
    ],
    render: renderBanner
  },
  header: {
    id: 'header',
    displayName: 'Header',
    thumbnailUrl: 'img/cert-thumb-header.png',
    aspect: { width: 2050, height: 1080 },
    colorSlots: ['borderColor', 'accentColor', 'textColor'],
    variables: [
      'teamName',
      'recipientName',
      'playerNumber',
      'awardTitle',
      'description',
      'seasonLabel',
      'signers',
      'foregroundImage'
    ],
    render: renderHeader
  }
};
```

### `js/certificates/renderer.js`

Pure render path used by preview and export.

```javascript
export function renderCertificate({ shared, draft, team }) {
  const template = TEMPLATES[shared.templateId] || TEMPLATES.banner;
  const colors = resolveColors(shared, team, template);
  const node = document.createElement('div');
  node.className = 'cert-canvas';
  node.dataset.templateId = template.id;
  node.style.width = `${template.aspect.width}px`;
  node.style.height = `${template.aspect.height}px`;
  node.innerHTML = template.render({ shared, draft, team, colors });
  return node;
}
```

The exporter must attach the rendered node off-screen before calling `html-to-image`, because the export library reads computed styles.

### `js/certificates/assets.js`

The certificate asset pipeline follows the existing site upload pattern:

- Import `imageStorage` and `requireImageAuth` from `../firebase-images.js?v=4`.
- Import `ref`, `uploadBytes`, and `getDownloadURL` from `../firebase.js?v=11`.
- Sanitize filenames with the same style used by chat uploads: `String(name || 'media').replace(/[^\w.\-]+/g, '_')`.
- Validate file type and size before upload.
- Store asset metadata in Firestore after the upload succeeds.

```javascript
import {
  auth,
  db,
  collection,
  addDoc,
  serverTimestamp,
  ref,
  uploadBytes,
  getDownloadURL
} from '../firebase.js?v=11';
import { imageStorage, requireImageAuth } from '../firebase-images.js?v=4';

const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export async function uploadCertificateAsset(teamId, file, kind) {
  validateCertificateAsset(file);
  await requireImageAuth();

  const safeName = sanitizeFileName(file.name);
  const storagePath = `certificate-assets/${teamId}/${Date.now()}_${kind}_${safeName}`;
  const snapshot = await uploadBytes(ref(imageStorage, storagePath), file);
  const downloadUrl = await getDownloadURL(snapshot.ref);

  const docRef = await addDoc(collection(db, 'teams', teamId, 'certificateAssets'), {
    storagePath,
    downloadUrl,
    kind,
    contentType: file.type || null,
    originalFilename: file.name || null,
    size: Number.isFinite(file.size) ? file.size : null,
    uploaderId: auth.currentUser?.uid || null,
    uploadedAt: serverTimestamp()
  });

  return { id: docRef.id, storagePath, downloadUrl, kind };
}
```

Signature uploads use the same upload primitives but a user-scoped path:

```javascript
const storagePath = `certificate-signatures/${uid}/${Date.now()}_${safeName}`;
```

### `js/certificates/signers.js`

Builds default signers from the team owner and `team.adminEmails`, with owner first and admins in stored order. It should reuse existing user lookup helpers if available; do not scan the whole users collection from this module.

Each signer snapshot:

```javascript
{
  userId: 'uid' || null,
  name: 'Coach Name',
  role: 'Head Coach',
  signatureStyle: 'script', // script | typed | image
  signatureImageUrl: null
}
```

### `js/certificates/aiDescriptions.js`

Bulk AI helper. It is designed around the roster, not a single button per player.

Imports follow current app usage:

```javascript
import { getAI, getGenerativeModel, GoogleAIBackend } from '../vendor/firebase-ai.js';
import { getApp } from '../vendor/firebase-app.js';
```

Recent game context should be built from existing data helpers:

- `getGames(teamId)` to fetch team games.
- Completed games are those with `status === 'completed'`, `status === 'final'`, or `liveStatus === 'completed'`; practices and cancelled games are excluded.
- Sort completed games newest first.
- Use the selected window: 10 by default, 5 when coach chooses the smaller window, or all available games if fewer exist.
- `getAggregatedStatsForGames(teamId, gameIds)` provides per-player totals from `teams/{teamId}/games/{gameId}/aggregatedStats`.
- Include game summaries from `game.summary` when present.

Prompt contract:

- Use only public roster fields and game-derived stats.
- Mention the player's recent contribution in a positive, youth-sports-appropriate tone.
- Use the coach-selected tone.
- Return 2-4 sentences.
- Do not mention private fields, medical status, family information, other named players, or unsupported claims.
- Return plain text only.

```javascript
export async function generateDescription({ team, player, stats, recentGames, shared }) {
  const app = getApp();
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const model = getGenerativeModel(ai, { model: 'gemini-2.5-flash' });
  const prompt = buildPrompt({ team, player, stats, recentGames, shared });
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}
```

Generation should be bounded to avoid spiking API usage. The studio should process players in a queue with a small concurrency limit, update row status as each player completes, and leave failed rows retryable without blocking the full batch.

### `js/certificates/exporter.js`

Exports the same DOM used by preview.

- `exportPng(node, scale)` awaits `document.fonts.ready` and image readiness.
- `exportPdf(node)` embeds the PNG in a `jsPDF` page matching the template aspect.
- `exportZip(items)` uses `jszip`.
- Saved exported PNGs upload to `certificate-exports/{teamId}/{certificateId}.png` via the same image storage pattern.
- Export warns before download if any image in the render tree failed to load.

## Data Model

### Certificate Batch

`teams/{teamId}/certificateBatches/{batchId}`

```javascript
{
  status: 'draft' | 'published' | 'archived',
  selectedPlayerIds: ['player_1', 'player_2'],
  certificateIds: ['cert_1', 'cert_2'],
  shared: {
    templateId,
    colorMode,
    customColors,
    teamNameOverride,
    awardTitle,
    seasonLabel,
    footerUrl,
    descriptionTone,
    statsWindow,
    signers,
    foregroundImageRef,
    backgroundImageRef,
    watermarkImageRef,
    watermarkOpacity
  },
  createdBy,
  createdByEmail,
  createdAt,
  updatedAt
}
```

### Saved Certificate

`teams/{teamId}/certificates/{certificateId}`

```javascript
{
  batchId: 'batch_123' | null,
  templateId,
  status: 'draft' | 'published' | 'archived',

  playerId: 'player_abc' | null,
  recipientName: 'Vivian Karpuk',
  playerNumber: '4' | null,
  playerPhotoUrl: 'https://...' | null,

  teamNameOverride: 'Junior Current' | null,
  awardTitle: 'Most Improved' | null,
  description: '...',
  descriptionSource: 'ai' | 'manual' | 'fallback',
  statsWindow: 10,
  seasonLabel: 'Fall 2025',
  footerUrl: 'www.jrkccurrent.com',

  colorMode: 'team' | 'template' | 'custom',
  colors: { borderColor, accentColor, textColor },
  foregroundImageRef,
  backgroundImageRef,
  watermarkImageRef,
  watermarkOpacity,
  signers,

  exportedPngUrl: null,
  exportedPdfUrl: null,
  createdBy,
  createdByEmail,
  createdAt,
  updatedBy,
  updatedByEmail,
  updatedAt
}
```

### Team Defaults

`teams/{teamId}/settings/certificateDefaults`

```javascript
{
  templateId,
  colorMode,
  customColors,
  seasonLabel,
  footerUrl,
  awardTitle,
  descriptionTone,
  statsWindow,
  signers,
  foregroundImageRef,
  backgroundImageRef,
  watermarkImageRef,
  watermarkOpacity,
  updatedAt,
  updatedBy
}
```

### Certificate Asset Metadata

`teams/{teamId}/certificateAssets/{assetId}`

```javascript
{
  storagePath,
  downloadUrl,
  kind: 'foreground' | 'background' | 'watermark' | 'generic',
  contentType,
  originalFilename,
  size,
  uploaderId,
  uploadedAt
}
```

## Database Functions

Add focused helpers to `js/db.js`, keeping Firestore writes centralized.

```javascript
export async function getCertificateDefaults(teamId) {}
export async function setCertificateDefaults(teamId, defaults) {}

export async function createCertificateBatch(teamId, data) {}
export async function updateCertificateBatch(teamId, batchId, data) {}
export async function listCertificateBatches(teamId, { status = 'draft', limit = 20 } = {}) {}

export async function listCertificates(teamId, { status = 'published', limit = 50 } = {}) {}
export async function getCertificate(teamId, certificateId) {}
export async function createCertificate(teamId, data) {}
export async function updateCertificate(teamId, certificateId, data) {}
export async function archiveCertificate(teamId, certificateId) {}
export async function listCertificatesForPlayer(teamId, playerId) {}

export async function listCertificateAssets(teamId) {}
export async function writeCertificateAudit(teamId, certificateId, event) {}
export async function writeCertificateBatchAudit(teamId, batchId, event) {}
```

Use existing `getPlayers(teamId)`, `getGames(teamId)`, and `getAggregatedStatsForGames(teamId, gameIds)` rather than adding parallel Firestore reads in the certificate modules.

## Access Control

Studio access:

- Team owner
- Team admins from `team.adminEmails`
- Global admins from `users/{uid}.isAdmin`

Parent access:

- Parents do not use the studio.
- Parents can read published certificates for linked players through parent dashboard cards.

Security rules reuse existing helper concepts:

- `isTeamOwnerOrAdmin(teamId)`
- `isParentForPlayer(teamId, playerId)`
- `isGlobalAdmin()`

The rules must cover:

- `teams/{teamId}/certificates/{certificateId}`
- `teams/{teamId}/certificates/{certificateId}/audit/{eventId}`
- `teams/{teamId}/certificateBatches/{batchId}`
- `teams/{teamId}/certificateBatches/{batchId}/audit/{eventId}`
- `teams/{teamId}/certificateAssets/{assetId}`
- `teams/{teamId}/settings/certificateDefaults`

## Entry Points

### Team Admin Banner

Add a `Certificates` card to `js/team-admin-banner.js` with `active: 'certificates'`. It should be shown only for full team access. Parent/slim access keeps its current layout.

### Existing Team Admin Experience

Add a primary **Create certificates** button for full-access coaches/admins. It routes to:

```text
certificates.html#teamId={teamId}
```

The button should launch the setup flow, not a blank single-player editor.

### Parent Dashboard

For linked players, show saved published certificates with thumbnail/download links. Parents only see certificates where `playerId` matches one of their `parentPlayerKeys`.

## Validation Notes

Implementation should verify:

- A coach can create a full-team certificate run with an existing roster and no manual per-player setup.
- AI descriptions use the last 5 or 10 completed games and never private roster fields.
- Uploading a transparent PNG preserves transparency in preview and export.
- Uploaded assets follow the images-project auth/upload pattern already used by the site.
- Preview and exported PNG match visually.
- Batch generation continues when a single player AI request or render fails.
- Parent dashboard only exposes published certificates for linked players.
