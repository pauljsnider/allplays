# Requirements Role Notes

## Objective
Address review comment `r2850555532` by ensuring markdown rendering cannot introduce XSS via inline markdown or URL linkification.

## User-Facing Risk
- Current blast radius: drill instructions rendered in coach/admin/player views.
- Risk to users: malicious text could execute in browser context if sanitization gaps exist.

## Acceptance Criteria
- Inline markdown (`**`, `*`, `` ` ``) must never emit unescaped user-controlled HTML.
- Linkification must only create anchors for validated `http`/`https` URLs.
- Anchor `href` and text must be safely escaped before insertion.
- Malformed URLs remain plain text.

## Controls
- Keep parser output behavior stable for valid drill markdown.
- Prefer minimal change to `js/drills-issue28-helpers.js` and existing test page.
