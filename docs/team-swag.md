# Team Swag Integration Design

Goal: Give each team an always-available swag/uniform store without building e-commerce. Keep it static-site friendly (GitHub Pages + Firebase) and cheap, while supporting both bulk uniforms and individual spirit-wear orders.

## Current App Fit
- Static frontend (HTML + JS modules) with Firebase Auth/Firestore; team ownership via `ownerId`, `adminEmails`, `isAdmin` check.
- Team data lives in `teams/{teamId}`; `team.html` and `edit-team.html` already handle metadata and admin controls.
- No payment infrastructure; outbound links/embeds are the right integration point.

## Recommended Approach (Two-Lane)
1) **Hosted team store link (primary)**: Use a turnkey provider that supports name/number personalization and year-round ordering (e.g., SquadLocker or BSN My Team Shop). Integration = store URL/button; no backend work.
2) **Optional embedded fan shop (secondary)**: For on-page merch, allow an embed snippet (e.g., Spreadshop JS widget) or a Printful/Printify storefront embed if desired. This is fan gear only; uniforms still go through the hosted store link.

Rationale: outbound link covers uniforms + customization with minimal effort; embed gives a native feel for spirit wear. Both avoid handling payments/inventory.

## Data Model Changes (Firestore: teams/{teamId})
Add optional fields (all public-read, admin-writable):
- `storeProvider`: string (`'squadlocker' | 'bsn' | 'blatant' | 'spreadshop' | 'custom'`)
- `storeUrl`: string (primary hosted store link; required if provider set)
- `storeEmbedHtml`: string (trusted embed snippet for fan shop; sanitized on render)
- `storeNotes`: string (plain text tips like "order uniforms by Aug 15" or promo code)
- `storeUpdatedAt`: Timestamp

No new collections needed; keep it simple.

## Security Rules
- Allow `update` of these fields only by team owner/admin/global admin (reuse existing team update rules). No special rules beyond current `/teams/{teamId}` update policy.

## UI/UX Changes
- **Edit Team (`edit-team.html`)**
  - Add a “Team Store” section for admins: provider select, store URL input (required if provider chosen), optional embed HTML textarea, store notes.
  - Basic validation: https URL; warn when embed present.
- **Team Page (`team.html`)**
  - If `storeUrl` exists: show a prominent CTA "Team Store" button (opens new tab) and optional subtitle with provider logo/text.
  - If `storeNotes`: display as a small info box.
  - If `storeEmbedHtml`: render in a sandboxed container (e.g., iframe with `srcdoc`) or inject only for allowed providers; hide when absent.
  - Keep visible to all viewers; no auth needed to click.
- **Dashboard/My Teams**
  - Add a small badge/tooltip on team cards when a store is configured (“Store live”).

## Client Logic (js/db.js + pages)
- Extend team save/load to include new fields (already allowed by Firestore merge).
- In `team.html`, safely render:
  - `storeUrl` → external link (`rel="noopener"`, `target="_blank"`).
  - `storeEmbedHtml` → prefer iframe `srcdoc` to avoid script collisions; only render if provider is in allowlist or content matches expected pattern (e.g., Spreadshop snippet). Otherwise, fall back to a link.
- No payment or cart logic added; everything stays offsite.

## Provider Notes (what fits this app)
- **Uniforms + personalization**: SquadLocker or BSN My Team Shop (hosted link; supports names/numbers; no minimums or timed windows if configured always-open).
- **Fan gear embed**: Spreadshop widget is easiest (single JS snippet, no backend); or link to provider page if embed not trusted.
- **Low-cost POD flexibility**: If desired later, link to Printful MerchShare/Printify storefront instead of embedding.

## Migration/Defaults
- Existing teams: `storeProvider`/`storeUrl` empty → no UI change.
- Backfill not required; admins opt-in per team.

## Testing Plan (manual)
- Set store URL and provider in Edit Team; verify save/load; button shows on team page and opens correctly.
- Add embed HTML (Spreadshop) and confirm sandboxed render; remove embed and ensure fallback link still works.
- Ensure non-admins cannot change store fields (rules + UI block) but can view/click store.
- Mobile check: CTA and embed responsive.
