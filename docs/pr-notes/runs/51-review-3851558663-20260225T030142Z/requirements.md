# Requirements Role (allplays-requirements-expert)

## Objective
Reduce security risk in drill markdown and safe-text rendering by only linkifying well-formed HTTP(S) URLs without degrading coach/parent readability.

## Current vs Proposed
- Current: Any `https?://` token matching a broad regex is linkified.
- Proposed: Candidate URLs are validated with `new URL()` and only valid `http:` / `https:` URLs are linkified.

## Risk Surface and Blast Radius
- Surface: Drill instructions and text rendered in drills and related chat-like content.
- Current blast radius: Invalid URLs can become clickable anchors, creating confusing or unsafe navigation behavior.
- Proposed blast radius: Invalid URL tokens remain plain text; rendering remains escaped and non-executable.

## Assumptions
- Existing HTML escaping remains the primary XSS control.
- Users expect sentence punctuation (`.` `,` `)`) to remain outside clickable links.

## Recommendation
Implement URL-parse validation in the shared helper used by both markdown inline rendering and safe text linkification, then cover malformed URL and punctuation boundaries in unit tests.

## Success Criteria
- Invalid URL candidates are not turned into anchors.
- Valid HTTP(S) URLs still render as clickable anchors.
- Existing escaping behavior remains intact.
