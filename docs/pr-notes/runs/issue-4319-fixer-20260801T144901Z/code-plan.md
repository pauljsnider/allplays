# Code plan

Baseline: `257b99bb38817e1fd5511710a5618d19ae48d7c3`.

1. Rename the existing shared dependency maintenance test so its scope is accurate.
2. Add `web-vitals` with specifier `^6.0.1` and resolved version `6.0.1` to its existing root/app manifest and npm lock assertion loop.
3. Rely on the adjacent app dependency maintenance test for app pnpm importer and package coverage.
4. Do not edit runtime instrumentation or regenerate lockfiles because the upgrade already landed through `73bd5e54` and `82c020e2`.
5. Run focused unit, build, dependency-tree, and browser smoke validation.

Commit scope is limited to this test and the four required role artifacts.
