# Code plan

1. Change only the dependency-version expectations for the issue's six packages in `tests/unit/app-capacitor-native-config.test.js`; keep unrelated Capacitor Firebase and plugin versions unchanged.
2. Run the focused test to demonstrate the stale repository fails the new contract.
3. Update matching specifiers in root and app manifests.
4. Use npm lockfile-only installation to resolve the requested versions without installing scripts or broadening unrelated dependencies.
5. Update the iOS SwiftPM exact requirement and resolved 8.5.3 tag revision.
6. Search Android files for version literals; make no Android edit if project-path wiring remains versionless.
7. Run focused and requested test commands, inspect the final diff for unrelated lockfile churn, then commit once with issue #5018 in the message.

The role subagent runtime was unavailable for this run; this artifact records the main-run implementation synthesis under the requested code-specialist lens.
