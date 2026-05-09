# Awards & Certificates Feature Requirements

## Introduction

ALL PLAYS already collects everything needed to celebrate a season — a team's name, colors, logo, roster, season, and coaching staff. Today, coaches who want to recognize players have to leave the app and rebuild that data inside Canva, PowerPoint, or Photoshop just to produce a one-page certificate. The result is days of off-platform copy/paste work at the end of every season.

The Awards & Certificates feature lets coaches generate share-ready player certificates directly from the app as a team workflow. The coach configures the common certificate parts once: template, team name, season, colors, team imagery, award title, footer, and signature block. The team's roster then supplies each player's name and number, and AI drafts each player's description from that player's recent stats and game context. The coach reviews the generated roster in a simple grid, makes only the few edits that are needed, and exports individual certificates or a full season pack.

Two reference designs supplied by the product owner (Junior Current — Vivian Karpuk; Wildcats Softball — Emily Clements) anchor the visual language: a colored outer border, a tall team-name banner, a large player name, an italic description paragraph, a centered season label, a centered team crest with optional watermark, and a row of script-font signatures with role lines underneath.

## User Stories

### US-1: Coach opens the certificate studio for a team
As a coach, I want to launch a "Certificates" page from the team admin banner so that I can build certificates for my team without leaving ALL PLAYS.

### US-2: Coach configures one team certificate run
As a coach, I want to set the shared certificate template, colors, season, award title, imagery, and signers once so that the whole roster uses a consistent design without repeated setup.

### US-3: Coach generates certificates for the whole roster
As a coach, I want the active roster to be selected by default and auto-filled with player names, numbers, and AI-generated descriptions so that I can produce season-end awards with only a few changes.

### US-4: Coach picks a template and color scheme
As a coach, I want to pick from a small library of templates and apply either the team colors or a custom color pair so that the certificate matches our identity.

### US-5: Coach uses team imagery automatically
As a coach, I want the team name, team logo, and team colors to pre-fill from the team profile so that I don't have to retype information that already exists in ALL PLAYS.

### US-6: Coach uploads custom foreground/background art
As a coach, I want to upload a PNG (transparent background preferred) for the certificate's foreground emblem and a separate background image so that I can match a specific season's branding.

### US-7: Coach reuses team-uploaded images
As a coach, I want to pick from images that have already been uploaded to the team (team photo, previously uploaded certificate art) so that I don't have to re-upload assets I've used before.

### US-8: Coach manages the signature block
As a coach, I want the signature block to default to the team owner and adminEmails coaches, with each coach's display name and an editable role label (e.g., "Head Coach", "Assistant Coach"), so that the right people are credited.

### US-9: Coach adds, edits, removes, or reorders signers
As a coach, I want to add a signer who isn't an admin (e.g., a guest assistant), update names and roles, remove a signer for a specific certificate, and drag signers into the order they should appear, so that I can match real-world reality.

### US-10: Coach tweaks the certificate fields
As a coach, I want to review generated certificates in a grid and override an individual player's name, jersey number, award title, description, or visibility before export so that I can hand-correct only exceptions.

### US-11: Coach previews live as they edit
As a coach, I want a real-time preview that reflects every form change so that I can see exactly what will be exported before I download.

### US-12: Coach exports a certificate
As a coach, I want to download the certificate as PNG (default) and optionally PDF so that I can print, post on social, or attach to email.

### US-13: Coach saves a certificate to the team
As a coach, I want to save a generated certificate to the team so that I can re-export it later without rebuilding it, share a link with parents, and keep a season archive.

### US-14: Parent views/downloads their player's certificate
As a parent of a linked player, I want to see saved certificates for my child and download them so that I can keep or print them at home.

### US-15: Coach batches an entire season pack
As a coach, I want a "Generate team certificates" action that produces one draft per selected active roster player, opens a review grid, and offers publish/export actions for the full team so that the bulk workflow stays simple.

### US-16: Coach uses team defaults to skip setup
As a coach, I want the team to remember my last certificate setup so that the next run starts mostly complete and I only need to change the season or award-specific details.

### US-17: Coach auto-generates player descriptions from recent stats
As a coach, I want AI to draft each player's certificate description from the last 5-10 completed games, player stats, and game summaries so that the first draft is already personalized for every selected player.

### US-18: Global admin manages the template library
As a global admin, I want to add, edit, retire, or feature templates so that the available designs can grow over time without requiring a code deploy for every new look.

### US-19: Coach respects roster privacy
As a coach, I want certificate generation to only use public roster fields (name, number, photo) and never private/sensitive fields so that no protected data appears on a shareable image.

### US-20: Coach creates non-player awards
As a coach, I want to create a certificate that isn't tied to a specific player (e.g., "Team of the Season", a parent volunteer award) by typing a custom recipient name so that I can recognize people who aren't on the roster.

## Requirements (EARS Format)

### 1. Access Control

1.1 The system shall allow certificate creation, editing, saving, and deletion to: the team owner, users in `teams/{teamId}.adminEmails`, and global admins (`users/{uid}.isAdmin == true`).

1.2 The system shall allow a parent linked to a player (entry in `users/{uid}.parentPlayerKeys` matching `${teamId}::${playerId}`) to read and download saved certificates whose `playerId` matches that linked player.

1.3 The system shall NOT allow unauthenticated users to create, save, or list certificates.

1.4 The system shall NOT include private/sensitive player fields (medical, emergency contact, etc.) anywhere in the certificate generation pipeline. Only public fields from `teams/{teamId}/players/{playerId}` shall be used.

1.5 The certificates studio entry shall NOT appear on the public team page (team.html).

### 2. Navigation & Entry Points

2.1 The system shall provide a "Certificates" navigation card on the team admin banner (`js/team-admin-banner.js`), active state `certificates`.

2.2 The system shall provide a link to a player's saved certificates from the parent dashboard (`parent-dashboard.html`) for each linked player that has at least one certificate.

2.3 The certificates entry on the team admin banner shall route to `certificates.html#teamId={teamId}` and respect the existing 'full' vs 'parent' access-level layout (parents see only the parent-facing view).

2.4 An optional deep link shall exist for editing a specific certificate: `certificates.html#teamId={teamId}&certificateId={certificateId}`.

2.5 An optional deep link shall exist for opening the studio pre-bound to a player: `certificates.html#teamId={teamId}&playerId={playerId}`.

2.6 The system shall provide a primary "Create certificates" button in the existing team admin experience for users with full team access; the button shall route to `certificates.html#teamId={teamId}` and open the team certificate setup flow.

### 3. Studio Page Layout

3.1 The studio page (`certificates.html`) shall default to a team certificate setup flow before the individual editor.

3.2 The setup flow shall have four simple steps: configure shared certificate settings, confirm selected players, generate AI descriptions, and review/export generated drafts.

3.3 The full desktop studio shall still support three primary work areas after generation: a sidebar of saved runs/certificates, a shared setup editor, and a live preview/review panel.

3.4 On viewports narrower than 1024px the studio shall stack: setup/player selection on top, review grid in the middle, preview at the bottom, with sticky "Preview" and "Export" buttons.

3.5 The studio shall render the team admin banner with `active='certificates'`.

3.6 The studio shall display a primary "Generate team certificates" button and a secondary "New custom certificate" action.

3.7 The default path shall require no per-player setup before generation; per-player edits happen in the review grid after drafts are created.

### 4. Player & Recipient Source

4.1 The system shall load the current active team roster (`teams/{teamId}/players`, public fields only) sorted by jersey number then name.

4.2 The setup flow shall select all active roster players by default and allow the coach to deselect players before generation.

4.3 For each selected player, the system shall populate the certificate's `playerName`, `playerNumber`, `playerId`, and `playerPhotoUrl` fields automatically from public roster fields.

4.4 The review grid shall allow manually overriding `playerName` and `playerNumber` for an individual draft without losing the underlying `playerId` link.

4.5 The editor shall still provide a "Custom recipient" path that hides the roster picker and exposes a free-text recipient name field, used for non-player awards (US-20).

### 5. Team Source

5.1 The system shall load the team document and pre-fill: `teamName` (= `team.name`), `teamPhotoUrl` (= `team.photoUrl`), and team colors (`team.colors.primary`, `team.colors.secondary`) when present.

5.2 The setup flow shall treat team name, team logo, team colors, season label, footer URL, award title, imagery, and signers as shared values that apply to every generated player certificate by default.

5.3 The editor shall allow the user to override the displayed team name for the run without modifying the team document.

5.4 If the team document does not have a `colors` map, the system shall fall back to a default palette (primary `#1e3a8a`, secondary `#dc2626`) and surface a "Set team colors" hint that links to `edit-team.html`.

### 6. Templates

6.1 The system shall provide at least two built-in templates at launch:
  - **Banner** — a colored outer border, large team-name banner at the top, large player name, italic description paragraph, centered season label, centered crest with watermark, signature row (modeled on the Junior Current sample).
  - **Header** — a thin top color bar, large player name and number, italic description, centered crest, signature row (modeled on the Wildcats Softball sample).

6.2 Each template shall be defined declaratively (template id, display name, thumbnail URL, supported variables, color slots) so that new templates can be added without changing call sites.

6.3 The system shall display a thumbnail picker of available templates and shall preserve the user's selection across sessions in the team's "certificate defaults" document (Section 11).

6.4 Each template shall declare which color slots it uses (`borderColor`, `accentColor`, `textColor`) and which variables it consumes; the editor shall hide controls for unused slots.

6.5 Templates shall declare a fixed export aspect ratio (default 2:1, 2050×1080 px equivalent) so that exported PNGs render consistently regardless of viewport.

### 7. Color Customization

7.1 The editor shall offer three color modes:
  - "Use team colors" (default if `team.colors` is set)
  - "Use template default"
  - "Custom" — exposes color pickers for each color slot the template declares.

7.2 The editor shall validate hex input on custom colors and show a contrast warning if a chosen `textColor` fails WCAG AA against its background.

7.3 The system shall persist the chosen color mode and any custom colors on the saved certificate document and on the team's certificate defaults.

### 8. Imagery: Foreground, Background, Watermark

8.1 The editor shall expose three image slots: `foregroundImage` (e.g., crest in the signature row), `backgroundImage` (full-canvas background), and `watermarkImage` (low-opacity centered behind text).

8.2 Each image slot shall offer three sources: "Use team logo", "Pick from team images", and "Upload new".

8.3 "Pick from team images" shall list any image previously stored under `teams/{teamId}/certificateAssets/{assetId}` plus the current `team.photoUrl`.

8.4 "Upload new" shall accept PNG, JPG, and WebP up to 5 MB; uploaded files shall be stored at `certificate-assets/{teamId}/{Date.now()}_{filename}` in the images Firebase project using the same site pattern as team/chat/drill uploads: `firebase-images.js`, `imageStorage`, `requireImageAuth`/`ensureImageAuth`, sanitized filenames, `ref`, `uploadBytes`, and `getDownloadURL`.

8.5 The system shall write a metadata document at `teams/{teamId}/certificateAssets/{assetId}` (storage path, original filename, contentType, uploaderId, uploadedAt, kind ∈ {foreground, background, watermark, generic}).

8.6 The watermark slot shall expose an opacity slider (0–100, default 12) and shall render the same image as the foreground if no watermark is explicitly chosen.

8.7 The system shall accept transparent PNGs and shall NOT add a fill color behind transparent regions.

### 9. Signature Block

9.1 The editor shall pre-populate the signature block with the team owner and each user listed in `team.adminEmails`, in the order: owner first, then adminEmails in their stored order.

9.2 For each pre-populated signer the system shall fetch the user's `fullName` (falling back to email local part) and shall use a default role of "Head Coach" for the first signer and "Assistant Coach" for subsequent signers; both name and role shall be editable on the certificate.

9.3 The editor shall allow adding a custom signer (not in adminEmails) via a free-text name and role.

9.4 The editor shall allow removing a signer for the current certificate without modifying the team's adminEmails list.

9.5 The editor shall allow reordering signers via drag-and-drop or up/down controls.

9.6 The editor shall enforce a maximum of 4 signers per certificate (templates may enforce a tighter cap).

9.7 The system shall offer one of three signature styles per signer: "Script font" (default, similar to the reference samples), "Typed", or "Image" (signer uploads a transparent PNG of their actual signature). Image signatures shall be stored under `certificate-signatures/{userId}/{Date.now()}_{filename}` in the images project.

9.8 If the user has no display name set, the editor shall surface a single inline prompt linking to `profile.html` rather than rendering "undefined".

### 10. Editor Fields

10.1 The setup flow shall expose the following shared fields, with defaults sourced as indicated:

| Field            | Default source                                             |
|------------------|------------------------------------------------------------|
| Team name banner | `team.name` (run-level override allowed)                   |
| Award title      | Empty (e.g., "Most Improved", optional)                    |
| Season label     | Last-used team default, or empty                           |
| Footer URL       | Last-used team default, or empty                           |
| Description tone | Last-used team default, or "celebratory and specific"      |
| Stats window     | Last-used team default, or last 10 completed games         |

10.2 The generated review grid shall expose the following per-player fields:

| Field          | Default source                                       |
|----------------|------------------------------------------------------|
| Recipient name | Selected player's `name` or custom recipient         |
| Jersey number  | Selected player's `number` (toggle to show/hide)     |
| Award title    | Shared setup award title, override allowed           |
| Description    | AI-generated from recent player stats, edit allowed  |

10.3 The description field shall enforce a soft limit of 500 characters with a visible character count and a hard cap of 800.

10.4 The setup flow shall provide a "Generate AI descriptions" action that generates descriptions for all selected players in bulk without requiring the coach to open each player first.

10.5 The "Generate AI descriptions" and per-player "Regenerate" actions shall call the existing Firebase AI client using the same pattern as `live-tracker.js`, `track-basketball.js`, and `live-game.js`: import from `js/vendor/firebase-ai.js`, call `getApp()`, instantiate `getAI(app, { backend: new GoogleAIBackend() })`, and use `getGenerativeModel(ai, { model: 'gemini-2.5-flash' })`. The prompt shall pass the player's name, jersey number, the team's sport, summaries from the selected stat window, and that player's aggregated stats from the last 5-10 completed games in `teams/{teamId}/games/*/aggregatedStats`. Returned text shall populate the description field as editable text and shall NEVER include private roster fields.

10.6 The default stat window shall be the last 10 completed games. If fewer than 10 completed games exist, the system shall use all available completed games; if more than 10 exist, the coach may reduce the window to the last 5 games.

10.7 The system shall preserve user edits to a description if "Regenerate" is clicked — the previous text is moved into a "Restore previous" undo slot for that player.

10.8 If no usable stats exist for a selected player, the AI prompt shall fall back to roster-safe context (player name, jersey number, team name, sport, season label, and coach-selected tone) and the review grid shall flag the description as "needs review".

### 11. Team Certificate Defaults

11.1 The system shall maintain a single per-team defaults document at `teams/{teamId}/settings/certificateDefaults` containing: `templateId`, `colorMode`, `customColors`, `seasonLabel`, `footerUrl`, `awardTitle`, `descriptionTone`, `statsWindow`, `signers` (ordered list of `{userId|null, name, role, signatureStyle, signatureImageUrl|null}`), `foregroundImageRef`, `backgroundImageRef`, `watermarkImageRef`, `watermarkOpacity`, `updatedAt`, `updatedBy`.

11.2 The first time a coach saves or exports a certificate run, the system shall write `certificateDefaults` so that subsequent runs start mostly complete.

11.3 The studio shall expose a "Save as team default" button that explicitly updates `certificateDefaults` and a "Reset to defaults" button on the editor.

### 12. Saved Certificates

12.1 The system shall persist saved certificates at `teams/{teamId}/certificates/{certificateId}` with fields: `batchId | null`, `templateId`, `colorMode`, `colors`, `teamNameOverride`, `playerId | null`, `recipientName`, `playerNumber | null`, `playerPhotoUrl | null`, `awardTitle | null`, `description`, `descriptionSource` ∈ {ai, manual, fallback}, `statsWindow`, `seasonLabel`, `footerUrl`, `signers`, `foregroundImageRef | null`, `backgroundImageRef | null`, `watermarkImageRef | null`, `watermarkOpacity`, `exportedPngUrl | null`, `exportedPdfUrl | null`, `createdBy`, `createdAt`, `updatedBy`, `updatedAt`, `status` ∈ {draft, published, archived}.

12.2 Saved certificates shall NOT duplicate the player's underlying private fields — only the cached display values needed to re-render.

12.3 Re-saving a certificate shall update `updatedAt`/`updatedBy` and bump `status` from `draft` to `published` if explicitly published.

12.4 Coaches shall be able to delete a certificate (soft delete via `status='archived'`); global admins may permanently delete.

12.5 The system shall surface a "Saved certificates" list in the studio sidebar with thumbnail, recipient name, season label, and last-modified timestamp.

### 13. Export

13.1 The system shall export a certificate as PNG at the template's declared export resolution.

13.2 The system shall offer an optional PDF export at the same resolution.

13.3 PNG/PDF export shall happen client-side using a vetted DOM-to-image library (Section 6 of design.md) and shall NOT require a server round-trip.

13.4 When a certificate is saved AND exported, the resulting PNG shall be uploaded to `certificate-exports/{teamId}/{certificateId}.png` and its URL written to `exportedPngUrl` on the certificate document so it can be re-shared without re-rendering.

13.5 Filenames shall default to `{teamSlug}-{recipientNameSlug}-{seasonSlug}.png|pdf` (e.g., `junior-current-vivian-karpuk-fall-2025.png`).

13.6 The exporter shall warn the user before download if any image asset failed to load (avoiding silently producing certificates with broken icons).

### 14. Batch / Season Pack

14.1 A "Generate team certificates" action shall open the team setup flow with shared certificate settings prefilled from the team document and `certificateDefaults`.

14.2 The setup flow shall display the active roster as checkboxes with all active players checked by default.

14.3 On submit, the system shall create one draft certificate per selected player using the same template, colors, signers, season label, award title, imagery, footer, description tone, and stats window.

14.4 The system shall generate AI descriptions for all selected players as part of draft creation, using each player's stats from the selected last 5-10 completed games.

14.5 The user shall land on a review grid where each row shows player name, jersey number, generated description status, quick edit controls, preview, and include/exclude toggle.

14.6 The review grid shall provide bulk actions for "Regenerate selected descriptions", "Save all drafts", "Publish all", "Export selected", and "Download ZIP".

14.7 The user shall be able to download the entire batch as a ZIP via a single "Download ZIP" button.

14.8 If any single AI description or render fails, the rest of the batch shall continue and the failed players shall be flagged in the review grid with a retry button.

14.9 The system shall persist a lightweight batch/run record at `teams/{teamId}/certificateBatches/{batchId}` containing the shared setup values, selected player ids, generated certificate ids, createdBy, createdAt, updatedAt, and status ∈ {draft, published, archived}.

### 15. Real-Time Preview

15.1 Form changes shall update the on-screen preview within 200 ms.

15.2 The preview shall be the same DOM tree that is exported (single source of truth) so that "what you see is what you download".

15.3 The preview shall provide a "Fit", "100%", and "200%" zoom toggle.

### 16. Storage & Indexes

16.1 The Firestore composite index `certificates` (teamId, status, updatedAt desc) shall be added to `firestore.indexes.json` to support the saved certificates list.

16.2 Firebase Storage rules in the images project shall allow authenticated users with team owner/admin/global-admin scope to write to `certificate-assets/{teamId}/*` and `certificate-exports/{teamId}/*`, and to write to `certificate-signatures/{userId}/*` for their own signature only.

### 17. Error Handling & Edge Cases

17.1 If a selected player is later deleted, saved certificates shall continue to render using their cached display values.

17.2 If a referenced image asset is deleted from storage, the editor shall display a "Missing asset — re-upload?" placeholder rather than failing silently.

17.3 If the team document has no name (corrupt state), the editor shall fall back to "Team" as the displayed banner and surface a banner-level warning.

17.4 If the user has no permission to read a team they navigated to, the system shall redirect to the dashboard with an error toast (matching existing pattern in team-chat).

17.5 If AI description generation fails for one or more players (network, quota, content filter), the editor shall surface a non-blocking row-level error, leave any existing description untouched, and allow retrying only the failed or selected players.

### 18. Analytics & Audit

18.1 Certificate creates, AI description generations, exports, and deletes shall write a single audit entry to `teams/{teamId}/certificates/{certificateId}/audit/{eventId}` with `action`, `actorId`, `actorEmail`, `at`, and (for exports) `format`.

18.2 Batch creates, publishes, exports, and archives shall write a single audit entry to `teams/{teamId}/certificateBatches/{batchId}/audit/{eventId}` with `action`, `actorId`, `actorEmail`, and `at`.

18.3 No PII beyond the actor's email shall be written into the audit log.

## Out of Scope (Deferred)

- Sending certificates by email directly from the app (Mailgun/SES integration). Coaches can download and share.
- Public shareable certificate URLs (e.g., `/c/{shortId}`) viewable without login.
- Animated/HTML certificates for digital trophies.
- Real signature capture via touchscreen (only static images supported in v1).
- Multi-language UI inside the certificate body (the studio chrome may be localized; certificate text is whatever the coach types).
- Bulk import of descriptions from a CSV (use AI suggest + manual edit in v1).
- Per-player photos embedded inside the certificate body (player photos sit on rosters, not on the certificate face) — deferrable to v1.1.
- Custom font upload by team owners (v1 ships with a curated set of Google fonts).
