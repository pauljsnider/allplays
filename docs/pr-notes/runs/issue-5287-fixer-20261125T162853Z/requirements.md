# Requirements analysis

## Acceptance criteria

- Accept Hosting only when evidence contains both the site-specific terminal release summary and the final Firebase deployment-completion summary.
- Reject progress signals such as upload completion, version finalization, release start, or exit zero when either terminal signal is absent.
- Fail closed on missing, partial, generic, or non-authoritative summaries.
- Bind accepted evidence to the expected Firebase project and Hosting site.

## Scope boundaries

- Add a dedicated Hosting evidence type and validation path.
- Do not change aggregate or individual Function evidence, completeness rules, unchanged-target logic, retry preservation, or incomplete-target metadata.
- Do not wire the validator into the production workflow or change release markers, Pages, smoke checks, authorization, rules, or migrations.

## Root cause

The current application evidence contract proves only declared project, targets, label, and artifact identity. It has no field proving that Firebase Hosting reached `release complete` or emitted the final `Deploy complete!` summary, so progress-only or exit-zero output can be represented as a finished application deploy.

## Edge cases and regression coverage

- Accept exact, complete release and deployment summaries for the expected site.
- Reject release completion without the final deployment summary.
- Reject a final-looking summary without an authoritative site release.
- Reject upload, finalization, and releasing progress as completion.
- Reject generic success text, wrong project/site identity, malformed fields, and extra fields.
- Run the existing Function suite unchanged to prove isolation.
