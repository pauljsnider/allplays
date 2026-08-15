# Target State and Public Boundaries

Status: Proposed

Depends on: Current AllPlays repository, GitHub account, Firebase project, DNS provider, and PaulBot behavior

## Objective

Define the destination, irreversible facts, plan assumptions, non-goals, and public/private information boundary before any implementation changes occur.

## Requirements

1. `https://allplays.ai` remains the canonical public application origin. `https://www.allplays.ai` returns a permanent redirect to the canonical apex and preserves safe path and query behavior.
2. Firebase Hosting becomes the only production web host. GitHub Pages is retained only as a time-bounded DNS rollback host during observation and is then fully retired before repository privacy.
3. The GitHub repository becomes private only after Firebase serves production, no DNS record targets Pages, Pages is unpublished, and the Pages custom-domain binding is removed.
4. The recommended account baseline is GitHub Pro for a private personal repository. The preflight must prove that protected branches, required checks, repository environments, environment secrets/variables, and intended collaborators are available before cutover.
5. A GitHub Free private variant is not an implicit fallback. It requires a separate accepted design for every unavailable protection and environment dependency and must provide server-enforced protection equivalent to the current default-branch boundary. PaulBot policy alone is not equivalent protection.
6. Making the repository private protects future access only. Previously published commits, releases, Actions logs, copied source, package contents, and detached public forks must be treated as permanently disclosed.
7. Public forks are expected to remain public and detach from the newly private repository. The migration does not attempt to delete, privatize, or regain control of third-party forks.
8. The visibility change may erase stars and watchers, unpublish Pages, disable code scanning or other public-only security features, change fork/contribution behavior, and affect anonymous links. Each consequence must have an accepted disposition before execution.
9. Existing public issue, pull-request, workflow, check, and label names may be referenced in this folder. Live identities, secrets, infrastructure coordinates, and private operator evidence may not.
10. An exact private operator record must exist before the first provider mutation. It contains the current DNS export, Pages state, domain ownership state, GitHub plan and protection export, collaborator/app inventory, workflow environment inventory, credential map, billing baseline, rollback values, and evidence links.
11. The private operator record must be encrypted or access-controlled outside the repository, versioned for the migration, and recoverable by the owner. The public spec may define its schema but never its values.
12. App Check enforcement, Firebase project migration, application feature changes, native app release changes, email/DNS redesign, and unrelated PaulBot tuning are out of scope unless a preflight proves they are required for hosting parity.

## Design

### Recommended target

The safe target is a private personal repository on GitHub Pro, protected `master`, keyless GitHub Actions identities, manual exact-SHA production dispatch, Firebase Hosting on the apex, a canonical `www` redirect, and a repository-scoped PaulBot GitHub App installation. GitHub Pro is recommended because the current control plane relies on protected branches and private-repository environments; removing those controls to save the plan fee creates a much larger operational and security migration.

### Public versus private artifacts

Public documents can explain architecture, invariants, check names, workflow names, expected vendor behavior, aggregate measurements, and validation commands. The private operator record resolves symbolic values to exact provider records and identities. Pull-request bodies, issue comments, workflow summaries, screenshots, and Slack notifications follow the same redaction boundary because they can be retained or forwarded independently of repository visibility.

### Capability decision gate

Vendor feature availability must be tested, not inferred from the marketing plan name. Before implementation, record the actual account plan and verify the required private-repository APIs in a disposable private test repository or another nonproduction proof. If branch protection, environments, OIDC, required checks, or collaborator access do not behave as required, stop and choose a different plan or redesign before touching production.

### Historical disclosure

A full-history secret scan reduces ongoing risk but cannot make already public secrets private. Any valid credential or sensitive capability found in public history is an incident requiring revocation, rotation, and downstream review. Rewriting Git history is not part of this migration and would not remove detached copies.

## Decision record

| Decision | Recommended choice | Blocking alternative |
|---|---|---|
| Repository plan | GitHub Pro personal account | Free private only with separately approved equivalent controls |
| Production host | Firebase Hosting | No dual long-term production hosting |
| Canonical origin | Apex domain | `www` redirects permanently |
| Production trigger | Owner-authorized exact-SHA manual dispatch | No bot-owned or merge-only production deploy |
| Deployment identity | Keyless, claim-bound federation | No service-account key files |
| Public history | Accept as permanently public | No claim that privacy retracts old source |
| App Check | Preserve current enforcement state | Separate rollout required for any enforcement change |

## Tasks

- [ ] Capture the exact base SHA and re-inventory the then-current default branch.
- [ ] Confirm repository ownership model, selected GitHub plan, plan price, and private feature availability.
- [ ] Export current branch protection, required checks, repository settings, collaborators, Apps, environments, secrets/variable names, Pages state, and Actions permissions to the private operator record.
- [ ] Export authoritative DNS, current TTLs, CAA, domain registrar/host controls, and Pages custom-domain state to the private operator record.
- [ ] Inventory external links, badges, webhooks, status dashboards, release consumers, and documentation that assume a public repository or Pages URL.
- [ ] Run a full-history secret and sensitive-data scan; rotate every live finding and record only sanitized completion evidence publicly.
- [ ] Resolve the status of active public forks, external claims, public security tooling, and anonymous contribution paths.
- [ ] Record explicit owner approval for the target state and non-goals before implementation begins.

## Acceptance evidence

- A dated, access-controlled operator record exists and passes a second-person or independent completeness review.
- A private test proves the selected plan supports the required branch, environment, Actions, OIDC, and collaborator capabilities.
- No unresolved valid secret remains in current files or reachable public history.
- Every known public-only repository feature has an accepted replacement, retirement, or risk decision.

## Public sources

- [Changing repository visibility and effects on Pages and forks](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)
- [Protected branch availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches)
- [Environment availability and private-repository behavior](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
