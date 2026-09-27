# DRAFT — Privacy Policy: data-use, de-identification, and marketing

> **STATUS: DRAFT · NOT IN FORCE · NOT LEGAL ADVICE**
>
> This is proposed language for a section of `privacy.html`. It is **not
> published** and **not binding**. It must be reviewed and approved by qualified
> legal counsel before any of it is placed into the live Privacy Policy. See
> [`README.md`](README.md) for the adoption process.

## Proposed section (conservative baseline)

The following is the exact language proposed for insertion into `privacy.html`,
after the "How information is used" section and before "Service providers".

> ### Product development, de-identified data, and marketing
>
> We may create de-identified and aggregated information — information that does
> not identify, and cannot reasonably be used to identify, any individual,
> athlete, or team — and use or share it to operate, analyze, secure, benchmark,
> and improve ALL PLAYS, to develop new features and products, and to report on
> overall trends. We maintain de-identified information as non-personal and do
> not attempt to re-identify it.
>
> We may use an adult account holder's contact information to send information
> about ALL PLAYS features, subscriptions, and offers; you can opt out of
> non-essential messages at any time. **We do not sell personal information, and
> we do not use athlete or minors' information for third-party advertising or
> share it with third parties for their own marketing.** Paid subscriptions and
> features are billed through the applicable app store or payment provider under
> their terms.

## Clause-by-clause notes (for counsel)

1. **De-identified & aggregated data** — Intends to reserve broad internal use
   plus sharing of *non-personal* aggregates (analytics, benchmarking, new
   features, trend reporting), with a commitment not to re-identify.
   - *Counsel to confirm:* Does the stated de-identification standard meet the
     applicable legal bar (e.g. CCPA/CPRA "deidentified" requirements —
     technical safeguards, business-process prohibitions on re-identification,
     and contractual obligations on recipients)? Is "aggregated" defined
     adequately?

2. **First-party marketing to adults** — Uses account-holder contact info for
   ALL PLAYS's own product/subscription messaging, with opt-out.
   - *Counsel to confirm:* Opt-out vs opt-in requirements; CAN-SPAM / TCPA if
     SMS is ever used; whether any marketing may reach accounts that manage
     minors.

3. **Bright lines (bolded)** — No sale of personal information; no use of
   athlete/minors' data for third-party advertising; no sharing of identifiable
   data for third parties' own marketing.
   - *Counsel to confirm:* Whether "sell" and "share" here should be tied to the
     **statutory** definitions (CCPA/CPRA define both broadly — e.g. some
     cross-context behavioral advertising counts as a "share"), and whether a
     "Do Not Sell or Share" mechanism is required.

4. **Billing** — Paid features billed via app store / payment provider under
   their terms.
   - *Counsel to confirm:* Consistency with Apple/Google billing rules and any
     refund/renewal disclosures.

## Bright lines this draft preserves

- **No selling** of personal information.
- **No** athlete/minors' information used for third-party advertising.
- **No** sharing of identifiable data with third parties for their own
  marketing.

These are the commitments the youth-sports context most needs; counsel should
treat them as constraints to keep, not soften, absent a specific reason.

## Optional broader-monetization variant (HIGHER RISK — not recommended without counsel)

The product intent is to *not rule out* future monetization. If, after legal
review, ALL PLAYS wants to reserve options beyond the conservative baseline
(e.g. sharing pseudonymous data with partners, or third-party analytics/ad
SDKs), that is a **materially higher-risk** posture for a product holding
children's data and would require, at minimum:

- Explicit, separately-consented disclosures (not buried in a general policy).
- A COPPA analysis for anything touching under-13 data, including verifiable
  parental consent mechanics.
- CCPA/CPRA "sale"/"share" treatment and a "Do Not Sell or Share My Personal
  Information" link and workflow.
- App/Play Store data-practice disclosures kept in sync.

**Do not draft or publish the broader variant without counsel leading it.** This
file intentionally does not contain broader-variant wording.

## Open questions for counsel

- [ ] Is the de-identification/aggregation standard sufficient under CCPA/CPRA
      (and any other applicable state law)?
- [ ] Should "sell" / "share" map to statutory definitions, and is a
      Do-Not-Sell-or-Share mechanism required?
- [ ] COPPA: does any described use touch under-13 data, and if so what consent
      is required?
- [ ] Are there jurisdictions in scope beyond the US? (Product intent today is
      US-only.)
- [ ] Marketing: opt-out sufficient, or opt-in required for any channel/segment?
- [ ] Does the app's *actual* behavior match every commitment above? (Do not
      publish commitments the system does not enforce.)

## Provenance

This language was originally proposed in
[PR #4554](https://github.com/pauljsnider/allplays/pull/4554) and removed before
merge pending this review. It corresponds to the section previously marked in
`privacy.html` with an inline `LEGAL REVIEW REQUIRED` comment.
