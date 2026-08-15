# Actions Cost and Retention

Status: Proposed

Depends on: Specifications [1](./01-target-state-and-public-boundaries.md), [2](./02-ci-and-deployment-architecture.md), and [3](./03-identity-secrets-and-trust.md)

## Objective

Measure the cost created by private-repository Actions, reduce it before privacy, and enforce durable workload and retention budgets without weakening required validation or production recovery.

## Current-state estimate

The planning number is **approximately $490 per month** after privacy.

Methodology, captured August 15, 2026:

- Query completed GitHub-hosted jobs created from August 1 through August 14, 2026.
- Calculate elapsed runner time from each job's start and completion timestamps.
- Round every job up to a whole minute, matching GitHub's published billing rule.
- Price Linux and macOS minutes at the published standard-runner rates effective during the sample.
- Project the 14-day result to 30 days, apply the recommended GitHub Pro included Actions allowance and plan price, and round to the nearest $10.
- Assume Firebase Hosting remains within its no-cost storage and transfer allowances and no unrelated account-owned repository consumes the shared included Actions allowance.

The sample contained approximately 14,100 completed jobs, 18,200 elapsed runner minutes, and 26,700 rounded billable minutes. Per-job rounding added roughly 46 percent over elapsed time, making the large number of short orchestration jobs a material cost driver. The 14-day modeled runner cost was approximately $234 before the included allowance.

This is a public-history forecast, not billing evidence. A private billing export must replace it in the operator record before cutover. Vendor pricing, taxes, artifact storage, shared account usage, retries, and a different activity mix may change the invoice.

## Requirements

1. The repository must remain public until a complete seven-day shadow forecast projects no more than $25 per month total incremental cost, including the selected GitHub plan, Actions overage, Actions/Packages storage overage, and expected Firebase Hosting overage.
2. The forecast uses job-level timestamps and operating systems, rounds each job according to current vendor rules, includes cancelled and failed jobs that consumed runner time, and attributes reusable workflows to the caller that caused them.
3. The cost report groups usage by workflow, event, runner OS, actor class, pull request, retry/cancellation state, and workload class. Public output contains aggregates only; account-wide usage and billing exports remain private.
4. Required tests, production deploys, recovery health, security response, and post-deploy smoke may not be silently skipped to satisfy a budget. Cost controls reduce duplication and frequency or block new optional work with a visible typed state.
5. Superseded pull-request and preview runs use concurrency cancellation. Scheduled controllers do not start work already covered by an active or recently completed exact-head run.
6. Spec-only and other low-impact changes retain stable required check contexts while avoiding dependency installs, browser suites, native work, previews, and production artifact rebuilds that do not apply.
7. macOS work runs only for relevant native source/configuration changes, an approved mobile release, or an explicit diagnostic dispatch. Documentation, server-only, and unrelated web changes must not start macOS jobs.
8. Short metadata/control jobs are consolidated into already-running jobs or use the least expensive suitable runner when doing so does not collapse a trust boundary or reduce failure isolation.
9. PaulBot batches compatible updates, caps concurrent active work, avoids repeated no-change refreshes, and enters `budget-guard` before optional automation can cause overage.
10. Artifacts use the shortest retention compatible with their purpose. Transient untrusted handoff artifacts default to one day; failure evidence defaults to seven days; production provenance and signed release artifacts retain only the explicitly justified recovery period.
11. Caches are keyed narrowly, restored only across compatible trust contexts, bounded below the repository cache allowance, and evicted when they no longer reduce more runner cost than they consume in storage or upload time.
12. Account and repository budget alerts are enabled at early-warning, intervention, and critical thresholds. A hard account-level stop is used only if an independently tested emergency release and recovery path remains available.
13. Cost optimization must not introduce self-hosted runner trust into privileged workflows by default. Any self-hosted alternative requires a separate isolation, patching, secret, persistence, and capacity design and includes the current platform charge in its model.
14. Seven days after privacy and again after one full billing cycle, actual usage is reconciled against the forecast. Exceeding the accepted ceiling triggers `budget-guard` and a review before optional automation resumes.

## Design

### Cost ledger

Add a deterministic reporting script that reads workflow-run/job metadata and emits a normalized ledger without job logs. Each row records a safe workflow category, event, runner class, started/completed duration, rounded minutes, modeled rate, conclusion, and causal PR or schedule class. The script accepts an explicit start/end range and a versioned price table, produces machine-readable private output, and prints only aggregate public summaries.

### Optimization priority

Apply reductions in this order:

1. Eliminate duplicate triggers and no-op runs.
2. Cancel superseded heads and coalesce controller refreshes.
3. Preserve spec-only and path-based skips behind stable wrapper contexts.
4. Gate macOS and browser work by change impact and release intent.
5. Consolidate sub-minute orchestration jobs where trust boundaries allow it.
6. Shorten artifacts and remove caches that do not save net runner time.
7. Reduce scheduled frequency while preserving bounded detection and recovery objectives.
8. Consider runner substitutions only after workflow-level waste is removed.

### Budget behavior

The repository exposes a cost health state: `normal`, `warning`, `budget-guard`, or `release-only`. `budget-guard` stops new PaulBot discovery, nonessential previews, redundant scheduled analysis, and manual convenience workloads. `release-only` permits only explicitly owner-authorized production recovery, required security response, and the validation needed for those changes. Transitions and reasons are visible without publishing private spend data.

## Acceptance gates

| Gate | Evidence | Required result |
|---|---|---|
| Baseline | Complete seven-day job ledger | No missing runner classes or causal workflows |
| Optimization | Exact-head CI and safety suites | Stable contexts and trust boundaries unchanged |
| Forecast | Seven consecutive representative days | Projected total incremental cost at or below $25/month |
| Burst | Modeled high-activity day and PaulBot backlog | Budget modes activate before accepted ceiling is exceeded |
| Retention | Artifact/cache inventory | Every retained class has owner, purpose, and expiry |
| Post-private | Seven-day actual usage reconciliation | Within forecast tolerance; no unowned cost class |
| Billing-cycle | Provider invoice/usage export | Variance explained and policy adjusted |

## Tasks

- [ ] Commit a versioned, test-covered job-cost ledger using public metadata and externally configurable private billing inputs.
- [ ] Establish per-workflow, per-event, and per-runner baseline attribution for at least seven representative days.
- [ ] Add duplicate-trigger, cancellation, impact-routing, macOS-path, and scheduled-work contract tests.
- [ ] Consolidate safe short-lived jobs without combining trusted and untrusted execution.
- [ ] Add PaulBot concurrency, batching, no-change suppression, and budget-mode controls.
- [ ] Inventory every artifact and cache; assign retention, maximum size, purpose, and cleanup behavior.
- [ ] Configure included-usage and budget alerts with private recipients.
- [ ] Run a seven-day shadow forecast and obtain explicit acceptance of the monthly ceiling.
- [ ] Reconcile seven-day and full-cycle private usage after cutover.

## Public sources

- [GitHub plan pricing](https://github.com/pricing)
- [GitHub Actions included usage by plan](https://docs.github.com/en/billing/reference/product-usage-included)
- [GitHub Actions runner rates and per-job rounding](https://docs.github.com/en/billing/reference/actions-runner-pricing)
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [GitHub budgets and alerts](https://docs.github.com/en/billing/concepts/budgets-and-alerts)
- [Firebase Hosting quotas and transfer pricing](https://firebase.google.com/docs/hosting/usage-quotas-pricing)
