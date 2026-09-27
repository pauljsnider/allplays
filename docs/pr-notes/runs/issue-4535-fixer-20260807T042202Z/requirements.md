# Requirements

## Objective

Apply the narrow dependency-maintenance slice from issue #4535: upgrade the shared Firebase Web SDK from exact version `12.17.0` to `12.17.1`, and refresh the direct `web-vitals` resolution from `6.0.1` to `6.1.0`, without changing application behavior, configuration, or native code.

## Acceptance criteria

- Both manifests pin `firebase` exactly to `12.17.1`.
- Both npm lockfiles resolve direct `firebase` to `12.17.1` and direct `web-vitals` to `6.1.0`.
- The app pnpm lockfile aligns its importer, package, snapshot, and Capacitor Firebase peer-qualified entries with Firebase `12.17.1`, and resolves direct `web-vitals` to `6.1.0`.
- Both manifests retain the existing `web-vitals` range `^6.0.1`.
- The existing dependency-alignment contract fails on any partial manifest or lockfile update.
- Clean root and app installs, focused dependency/runtime tests, and the app production build pass.
- No UI, workflow, Firebase configuration, rules, Functions, Capacitor plugin, native shell, or legacy vendored module changes.

## Scope and non-scope

Scope is limited to root/app manifests, root/app npm locks, the app pnpm lock, and the nearest dependency contract test. Packages already at wanted/latest versions, broad refreshes, refactors, deployments, and native builds are excluded.

## Root cause

Firebase is exactly pinned, so the scan cannot advance it without coordinated manifest and lockfile edits. The `web-vitals` range already admits `6.1.0`, but deterministic lockfiles preserve `6.0.1` until refreshed. Other entries lacking `current` are scan-environment noise from absent `node_modules`, not actionable drift.

## Stakeholder and risk requirements

Coaches, parents, sports managers, and other users must see no behavior or workflow change. The main risk is partial or broad lockfile regeneration across three maintained lock surfaces; validation must prove atomic alignment and preserve unrelated dependency graphs.

## Measurable validation

- Focused dependency-alignment contract passes.
- Clean root and app npm installs succeed.
- Focused Firebase and web-vitals runtime tests pass.
- The app production build and bundle checks pass.
- Diff review shows only intended dependency metadata, the existing contract test, and these run artifacts.
