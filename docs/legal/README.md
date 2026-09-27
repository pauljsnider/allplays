# Legal drafts — held for counsel review

> **STATUS: DRAFT · NOT IN FORCE · NOT LEGAL ADVICE**
>
> Nothing in this directory is published, active, or binding. These are
> **proposed** documents that require review and approval by qualified legal
> counsel before any of the language is placed into a live policy
> (`privacy.html`, `terms.html`) or relied upon. Authored by engineering as a
> starting point for counsel — not by a lawyer.

## Why this directory exists

[PR #4554](https://github.com/pauljsnider/allplays/pull/4554) added a Terms of
Service / Privacy Policy **agreement gate** at signup (web app, legacy site, and
the ChatGPT MCP OAuth flow). That change shipped.

As part of that PR, a proposed **data-use / de-identification / marketing**
section was drafted for `privacy.html`. It was **intentionally removed before
merge** because it makes material privacy commitments — including about
**minors' data** — that must not be published until counsel has reviewed them.
A regression test now guards against that language reappearing in `privacy.html`
without review (see [Guardrail](#guardrail)).

This directory preserves that proposed language so it is ready to finalize once
legal sign-off is obtained, rather than being lost or re-drafted from scratch.

## Contents

| File | What it is |
| --- | --- |
| [`privacy-data-use-monetization.draft.md`](privacy-data-use-monetization.draft.md) | Proposed Privacy Policy section covering de-identified/aggregated data, product development, and marketing, with clause-by-clause annotations and open questions for counsel. |

## Background context (product intent)

The product goal is to **keep monetization options open** (subscriptions,
de-identified aggregate insights, first-party marketing) while holding firm
**bright lines** appropriate for a youth-sports product:

- No **selling** of personal information.
- No use of **athlete or minors'** information for third-party advertising.
- No **sharing** of identifiable data with third parties for their own marketing.

The draft is written conservatively around those lines. A broader-monetization
variant is described in the draft but flagged as higher risk.

## Why counsel review is non-negotiable here

This app stores children's data (athlete profiles, medical/emergency fields,
photos, guardian contacts). That triggers legal regimes a self-authored policy
should not attempt to satisfy alone, including but not limited to:

- **COPPA** — verifiable parental consent for under-13 data; a coach checking a
  box is not sufficient.
- **State youth-privacy / student-privacy laws.**
- **CCPA/CPRA** and other state comprehensive privacy laws — the statutory
  definitions of "sale" and "share" are broad and do not always match lay usage.
- **App Store / Play Store** kids/data policies.

Engineering can describe *what the system does with data*; only counsel can
decide *what may be committed to in a published policy*.

## Adoption process (when counsel approves)

1. **Counsel reviews and edits** the draft to final, jurisdiction-correct
   wording.
2. **Product/engineering confirm** the app's actual data practices match the
   approved wording (do not publish commitments the system does not honor).
3. Copy the approved language into `privacy.html` and **bump the `Effective`
   date**. Consider whether existing users must **re-consent** to the new
   version.
4. **Update the guardrail test** `tests/unit/mobile-store-legal-pages.test.js`
   (the `does not publish unapproved privacy policy expansion language` case) so
   it asserts the *approved* language is present, rather than asserting its
   absence.
5. Verify the signup consent flow still links the current published policy.

## Guardrail

`tests/unit/mobile-store-legal-pages.test.js` fails if `privacy.html` contains
the unapproved markers (e.g. `LEGAL REVIEW REQUIRED`, the section heading, or the
marketing sentence). This is deliberate: it prevents the held language from being
merged into the live policy before step 4 above is done.

## Disclaimer

These documents are engineering work product for the purpose of obtaining legal
review. They are **not legal advice** and do **not** represent ALL PLAYS's
current privacy commitments. The live policy is whatever is published at
`https://allplays.ai/privacy.html`.
