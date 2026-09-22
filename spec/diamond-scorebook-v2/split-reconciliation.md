# Diamond split source reconciliation

Source PR #4848: `f941e0d058888fe936e3e13f01635516d7736087`.
Base: `713cc18e645052e562a90a430c91b3855bf94940`.
This is an implementation/review manifest, not a merged or deployed receipt.

The original complete patch exceeded PaulBot's 16,000-line review bound. Each
replacement is reviewed against its immediate predecessor, then retargeted to
master after that predecessor has an exact-SHA production release and smoke.
Do not merge a descendant to retry a failed release. All non-root slices remain
draft until their predecessor is verified. No policy or rollout flag is enabled.

## Published sequence

Patch sizes below were measured on September 22, 2026 after engine security
commit `3df96372a`, generated engine `cf9302ed2`, and projection fixture
`2ea2449c7`. They include the complete patch, not only added lines.

| Slice | PR | Scope | Patch lines |
| --- | --- | --- | --- |
| 01 | #4853 | Pure engine and integrity | 12883 |
| 02 | #4854 | Golden corpus and generated engine | 10059 |
| 03 | #4855 | Unwired server foundations | 7442 |
| 04 | #4856 | Projections and admission | 12494 |
| 05 | #4857 | Projector and effects | 11370 |
| 06 | #4859 | Engagement and AI | 7401 |
| 07 | #4860 | Activation handlers | 13825 |
| 08 | #4861 | Command handlers | 14540 |
| 09 | #4862 | Client services | 9791 |
| 10 | #4863 | Deletion fences and indexes | 7989 |
| 11 | #4864 | Stat presentation | 5307 |
| 12 | #4865 | Unrouted scorer | 14762 |
| 13 | #4866 | Legacy reader context | 4479 |
| 14 | #4867 | Report and team readers | 9914 |
| 15 | #4868 | Complete-data/cache closure | 8407 |
| 16 | #4869 | Player reports | 7615 |
| 17 | #4870 | Report UI | 9451 |
| 18 | #4871 | Chat, reactions and wrap-up | 2158 |
| 19 | #4872 | Schedule and private AI | 1607 |
| 20 | #4873 | Certificates | 431 |
| 21 | #4874 | Personnel normalization | 133 |
| 22 | #4875 | Public stats tools | 569 |
| 23 | #4876 | Read-only viewer | 4841 |
| 24 | #4877 | Legacy reports | 10256 |
| 25 | #4878 | Dark schedule controls | 1848 |
| 26 | #4879 | Dark team setup | 1154 |
| 27 | #4880 | Legacy entry guards | 3085 |
| 28 | #4881 | Role-aware scorer controls | 875 |
| 29 | #4882 | Legacy AI and incentives | 689 |
| 30 | Final integration | Functions exports, Rules, dark route, deployment and acceptance | Measure on committed head |

## Deliberate differences from the source

- Existing app formatting is retained where source changes were formatting-only.
  This avoids placing unrelated mechanical churn in the reviewer's bounded patch.
- The engine includes review-driven corrections for deep-frozen rules, independent
  DH/FLEX starter histories and permanent DH termination, legal re-entry/courtesy
  runner participation, actual first-pitch opportunities, active-defense pitching
  credit, third-strike foul bunts, runner reach provenance, effective correction
  targets, and canonical IDs. Unfinished-PA pitching changes fail closed.
- Engine security validation scopes private-target evidence to corrections,
  binds duplicate receipt identities and chain metadata to the checkpoint,
  validates bounded recursive payload fields before hashing/persistence, and
  preserves own prototype-named JSON keys. Generated Functions output must match.
- The activation test suite is extracted from the original oversized handler
  suite; both suites remain in the acceptance command. No cases are dropped to
  reduce patch size.
- Golden fixtures emit only contract fields, and duplicate-retry fixtures use
  the committed checkpoint instead of pairing an older checkpoint with a future
  receipt. Tests do not weaken the security validator.
- First-pitch opportunity fields/formulas propagate through server projections
  and legacy presentation. Unknown or partial statistics remain unavailable.
- Shared module cache keys follow each actual changed base and its full consumer
  graph. Source snapshot cache numbers are not copied blindly. The committed
  exact-base cache guard is required for every landing head.
- Client personnel normalization and scorer selection preserve independent
  DH/FLEX and former-DH defender histories. Selection is revalidated before
  submission. Synthetic browser tests cover defensive starter re-entry and
  DP/FLEX defense changes without using production data.
- The direct scorer route has an additional runtime rollout guard. An authenticated
  deep link does not mount the scorer when the flag is absent, false, or malformed.
- Viewer boot nodes retain explicit IDs for the candidate-host selector parser.
  Help text describes access checks and the disabled rollout rather than universal
  public access. The generated help index follows the corrected source.
- Browser fixtures model complete module exports and explicit synthetic runtime
  configuration. Extra coverage checks pending statistics and incomplete AI
  evidence. One asynchronous scorer test waits for the actual committed revision
  before loading history.
- Final integration keeps new Functions exports and their Rules boundary together.
  Retry inventory, loader chains, test coverage metadata, artifact flag assertions,
  and historical index assertions include the new surfaces.
- Specification text now describes sequential delivery and the unfinished-PA
  limitation rather than claiming a single-PR implementation.

## Terminal evidence still required

Every ready exact head needs required CI, separate clean code and security
reviews, zero unresolved threads, and PaulBot approval without bypass. A squash
merge is not completion: require the exact merge SHA's successful deploy-prod,
matching production-release marker, and post-deploy-smoke before proceeding.
Physical-device and pilot validation are activation gates, not inferred from
unit or synthetic browser results. Keep Diamond dark throughout this landing.
