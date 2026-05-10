# Awards & Certificates Implementation Tasks

Tasks are grouped so implementation can land in small PRs. The default product path is a team certificate run: configure shared settings once, generate drafts for selected active players, AI-fill descriptions from recent stats, review in bulk, then publish/export.

## Phase 1: Branch, Page Shell, and Entry Points

- [ ] **1.1** Keep the full `spec/awards-and-certificates/` folder on the `awards` branch
  - Include `requirements.md`, `design.md`, `tasks.md`, and `validation-log.md`
  - *Ref: Req 2.1-2.6*

- [ ] **1.2** Create `certificates.html`
  - Match existing static page patterns: header/footer containers, Tailwind CDN config, ES module imports with cache-busting
  - Mount `#team-admin-banner`, `#cert-setup`, `#cert-player-selection`, `#cert-review-grid`, and `#cert-preview`
  - Load `css/certificates.css`
  - *Ref: Req 3.1-3.7; Design: Page Layout*

- [ ] **1.3** Create `js/certificates/studio.js`
  - Auth check and redirect-to-login on signed-out
  - Parse `teamId`, optional `batchId`, optional `certificateId`, and optional `playerId`
  - Load team, roster, defaults, saved runs, saved certificates, and recent games
  - Default mode is setup, not single-player edit
  - *Ref: Req 3.1-3.7; Design: studio.js*

- [ ] **1.4** Add Certificates card to `js/team-admin-banner.js`
  - Active key: `certificates`
  - Route: `certificates.html#teamId={teamId}`
  - Show only for full team access; parent/slim layout remains unchanged
  - *Ref: Req 2.1, 2.3*

- [ ] **1.5** Add primary **Create certificates** button to the existing team admin experience
  - Only visible to owner/admin/global-admin users with full team access
  - Routes to `certificates.html#teamId={teamId}` and opens the setup flow
  - *Ref: Req 2.6*

## Phase 2: Data Model, Firestore Helpers, and Rules

- [ ] **2.1** Add certificate access helpers to `js/db.js`
  - `canAccessCertificates(user, team)`
  - `canViewSavedCertificate(user, team, certificate)`
  - Mirror existing team owner/admin/global-admin and parent-player access patterns
  - *Ref: Req 1.1-1.4; Design: Access Control*

- [ ] **2.2** Add certificate defaults helpers to `js/db.js`
  - `getCertificateDefaults(teamId)`
  - `setCertificateDefaults(teamId, defaults)` using merge semantics
  - Include template, colors, season, footer, award title, description tone, stats window, signers, images, and watermark opacity
  - *Ref: Req 11.1-11.3*

- [ ] **2.3** Add certificate batch helpers to `js/db.js`
  - `createCertificateBatch(teamId, data)`
  - `updateCertificateBatch(teamId, batchId, data)`
  - `listCertificateBatches(teamId, options)`
  - `writeCertificateBatchAudit(teamId, batchId, event)`
  - *Ref: Req 14.9, 18.2*

- [ ] **2.4** Add certificate CRUD helpers to `js/db.js`
  - `listCertificates`, `getCertificate`, `createCertificate`, `updateCertificate`, `archiveCertificate`, `listCertificatesForPlayer`
  - Include `batchId`, `descriptionSource`, and `statsWindow`
  - Each create/update/export/archive writes an audit entry
  - *Ref: Req 12.1-12.5, 18.1*

- [ ] **2.5** Add Firestore rules
  - Coaches/admins can manage certificates, batches, assets, defaults, and audits for their team
  - Parents can read only published certificates for linked players
  - Audit subcollections are append-only
  - No unauthenticated reads/writes
  - *Ref: Req 1.1-1.4, 16.1-16.2*

- [ ] **2.6** Add indexes
  - Certificates by `status`, `updatedAt desc`
  - Certificates by `playerId`, `status`, `updatedAt desc`
  - Batches by `status`, `updatedAt desc`
  - *Ref: Req 16.1*

## Phase 3: Shared Setup Workflow

- [ ] **3.1** Render shared setup form
  - Template picker
  - Team name override
  - Season label
  - Award title
  - Footer URL
  - Color mode and custom color controls
  - Description tone
  - Stats window: last 10 or last 5 completed games
  - *Ref: Req 5.1-5.4, 6.1-7.3, 10.1, 10.6*

- [ ] **3.2** Load and apply team defaults
  - If no defaults exist, derive values from team name, logo, colors, owner, admins, and template defaults
  - First save/export of a run writes `certificateDefaults`
  - *Ref: Req 5.1, 11.1-11.3*

- [ ] **3.3** Render active roster selection
  - Use existing `getPlayers(teamId)` behavior
  - Active players selected by default
  - Coach can deselect players before generation
  - Sort by jersey number then name
  - *Ref: Req 4.1-4.3, 14.2*

- [ ] **3.4** Add custom recipient path
  - Secondary action, not the default flow
  - Allows non-player awards without changing the team-run happy path
  - *Ref: Req 4.5, US-20*

## Phase 4: Image Assets and Signers

- [ ] **4.1** Create `js/certificates/assets.js`
  - Import `imageStorage` and `requireImageAuth` from `../firebase-images.js?v=4`
  - Import `ref`, `uploadBytes`, and `getDownloadURL` from `../firebase.js?v=11`
  - Sanitize filenames with the existing chat-upload style
  - Validate PNG/JPG/WebP and max 5 MB
  - Upload to `certificate-assets/{teamId}/{Date.now()}_{kind}_{filename}`
  - Write metadata to `teams/{teamId}/certificateAssets/{assetId}`
  - *Ref: Req 8.1-8.7; Design: assets.js*

- [ ] **4.2** Build shared image-slot controls
  - Foreground image
  - Background image
  - Watermark image
  - Sources: team logo, existing team certificate assets, upload new
  - Watermark opacity slider, default 12
  - *Ref: Req 8.1-8.7*

- [ ] **4.3** Create `js/certificates/signers.js`
  - Default signers: team owner, then `adminEmails`
  - Reuse existing user lookup helpers where available
  - Allow add/remove/reorder, max 4
  - Support script, typed, and image signature styles
  - *Ref: Req 9.1-9.8*

- [ ] **4.4** Add signature image upload
  - Use the same image upload primitives as certificate assets
  - Store under `certificate-signatures/{userId}/{Date.now()}_{filename}`
  - *Ref: Req 9.7; Design: assets.js*

## Phase 5: AI Description Generation

- [ ] **5.1** Create `js/certificates/aiDescriptions.js`
  - Import Firebase AI from `../vendor/firebase-ai.js`
  - Import `getApp` from `../vendor/firebase-app.js`
  - Use `getAI(app, { backend: new GoogleAIBackend() })`
  - Use `getGenerativeModel(ai, { model: 'gemini-2.5-flash' })`
  - *Ref: Req 10.5; Design: aiDescriptions.js*

- [ ] **5.2** Build recent game context helper
  - Use existing `getGames(teamId)`
  - Treat `status='completed'`, `status='final'`, or `liveStatus='completed'` as completed
  - Exclude practices and cancelled games
  - Sort newest first
  - Use last 10 by default, last 5 when selected, or all available if fewer exist
  - *Ref: Req 10.5-10.6*

- [ ] **5.3** Build player stats context
  - Use existing `getAggregatedStatsForGames(teamId, gameIds)`
  - Extract per-player totals for selected players
  - Include game summaries from the same window when available
  - Never read private player profile fields
  - *Ref: Req 1.4, 10.5, 19*

- [ ] **5.4** Implement bulk description queue
  - Generate descriptions for all selected players after setup submit
  - Bound concurrency to avoid quota spikes
  - Row statuses: pending, ready, needs review, error
  - A single failed AI call does not stop the batch
  - *Ref: Req 10.4, 14.4, 14.8, 17.5*

- [ ] **5.5** Implement regenerate selected
  - Works for one row or selected rows
  - Preserves prior edited text in a row-level restore buffer
  - On failure, leaves existing text untouched
  - *Ref: Req 10.7, 14.6, 17.5*

- [ ] **5.6** Add fallback copy behavior
  - If a player has no usable stats, generate from roster-safe context only
  - Mark the row as `needs review`
  - *Ref: Req 10.8*

## Phase 6: Templates, Renderer, Preview, and CSS

- [ ] **6.1** Create `js/certificates/templates.js`
  - Banner template
  - Header template
  - Declarative metadata: id, display name, thumbnail, aspect, color slots, variables
  - Render from `{ shared, draft, team, colors }`
  - *Ref: Req 6.1-6.5; Design: templates.js*

- [ ] **6.2** Create `js/certificates/renderer.js`
  - `renderCertificate({ shared, draft, team })`
  - Used by both preview and export
  - Fixed 2050 x 1080 export canvas unless template declares another aspect
  - *Ref: Req 15.1-15.3*

- [ ] **6.3** Create `css/certificates.css`
  - Certificate canvas styles
  - Banner and Header layouts
  - Script signature styling
  - Watermark, crest, border, and footer styles
  - Responsive setup/review layouts
  - *Ref: Req 6.1, 15.1-15.3*

- [ ] **6.4** Add live preview
  - Preview updates within 200 ms after shared setup or selected row changes
  - Fit, 100%, and 200% zoom controls
  - Preview uses the same DOM tree as export
  - *Ref: Req 15.1-15.3*

- [ ] **6.5** Add color contrast helper
  - WCAG AA warning for custom text color against background/accent where applicable
  - *Ref: Req 7.2*

## Phase 7: Batch Creation and Review Grid

- [ ] **7.1** Implement **Generate team certificates**
  - Create a batch record
  - Create one draft certificate per selected active player
  - Copy shared setup values onto every draft
  - Generate AI descriptions as part of draft creation
  - *Ref: Req 14.1-14.4, 14.9*

- [ ] **7.2** Render review grid
  - Player name
  - Jersey number
  - Description status
  - Quick edit controls
  - Include/exclude toggle
  - Selected-row preview
  - Retry button for failed AI/render rows
  - *Ref: Req 10.2-10.8, 14.5, 14.8*

- [ ] **7.3** Add per-player overrides
  - Recipient name
  - Jersey number
  - Award title
  - Description
  - Include/exclude
  - Preserve `playerId`
  - *Ref: Req 4.4, 10.2*

- [ ] **7.4** Add bulk actions
  - Regenerate selected descriptions
  - Save all drafts
  - Publish all
  - Export selected
  - Download ZIP
  - *Ref: Req 14.6-14.7*

## Phase 8: Export and Saved Certificate Access

- [ ] **8.1** Vendor or add export dependencies
  - `html-to-image`
  - `jspdf`
  - `jszip`
  - Load from `js/vendor/` as ES modules
  - *Ref: Req 13.1-13.3*

- [ ] **8.2** Create `js/certificates/exporter.js`
  - Await `document.fonts.ready`
  - Validate image readiness before export
  - Export PNG at template resolution
  - Export PDF from PNG
  - Generate ZIP for selected rows
  - *Ref: Req 13.1-13.6*

- [ ] **8.3** Upload exported PNGs
  - Use existing image upload primitives
  - Store at `certificate-exports/{teamId}/{certificateId}.png`
  - Write `exportedPngUrl` back to certificate doc
  - *Ref: Req 13.4*

- [ ] **8.4** Render saved certificates list
  - Thumbnail
  - Recipient name
  - Season label
  - Last modified timestamp
  - Batch/run grouping where applicable
  - *Ref: Req 12.5*

- [ ] **8.5** Parent dashboard access
  - Query published certificates for linked players
  - Show thumbnail/download controls
  - Confirm parents cannot see unlinked players or drafts
  - *Ref: Req 1.2, 2.2, US-14*

## Phase 9: Error Handling and Edge Cases

- [ ] **9.1** Permission failures
  - Studio redirects unauthorized users to dashboard with toast
  - Parents who land on studio redirect to parent dashboard
  - *Ref: Req 17.4*

- [ ] **9.2** Missing data fallbacks
  - Missing team name: display "Team" and warning
  - Deleted player: render saved certificate from cached display values
  - Missing image asset: display "Missing asset - re-upload?"
  - *Ref: Req 17.1-17.3*

- [ ] **9.3** AI failures
  - Row-level error
  - Retry failed only
  - Existing description untouched
  - Batch continues
  - *Ref: Req 17.5*

- [ ] **9.4** Export failures
  - Warn on missing images
  - Retry render for a single row
  - ZIP continues for successful rows
  - *Ref: Req 13.6, 14.8*

## Phase 10: Validation

- [ ] **10.1** Team-run happy path
  - Existing team + roster can generate a full-team batch without per-player setup
  - Coach changes only season/award title and exports
  - *Ref: Req 3.1-3.7, 14.1-14.7*

- [ ] **10.2** AI description context
  - Player with 10+ completed games uses last 10 by default
  - Switching to last 5 changes the prompt context
  - Player with fewer games uses all available completed games
  - Player with no stats gets fallback copy and `needs review`
  - *Ref: Req 10.5-10.8*

- [ ] **10.3** Image upload
  - Upload PNG/JPG/WebP under 5 MB
  - Reject unsupported types and oversized files
  - Transparent PNG stays transparent in preview/export
  - Reusing an uploaded team certificate asset works
  - *Ref: Req 8.1-8.7*

- [ ] **10.4** Review grid
  - Per-player edits round-trip to saved certificates
  - Include/exclude affects export selection
  - Regenerate selected preserves previous text
  - *Ref: Req 10.2, 14.5-14.8*

- [ ] **10.5** Export
  - PNG and PDF match preview
  - ZIP contains one file per included selected row
  - Saved/exported PNG URL is written back
  - *Ref: Req 13.1-13.6*

- [ ] **10.6** Access control
  - Owner/admin/global-admin can manage
  - Parent can read/download only linked published certificates
  - Anonymous user cannot read/write
  - Cross-team reads are blocked
  - *Ref: Req 1.1-1.4*

- [ ] **10.7** Audit
  - Certificate creates, AI generations, exports, deletes write audit
  - Batch creates, publishes, exports, archives write audit
  - Audit entries cannot be edited/deleted
  - *Ref: Req 18.1-18.3*

## Acceptance

1. A coach can create a full-team certificate run from the existing team admin UI.
2. Shared setup is mostly prefilled from team data and defaults.
3. Active roster is selected by default.
4. AI generates editable player descriptions from the last 5-10 completed games.
5. The coach can review and correct all players in one grid.
6. The coach can publish/export selected certificates and download a ZIP.
7. Image upload and AI calls use the same implementation patterns as the rest of the site.
8. Parents can only view/download published certificates for their linked players.
