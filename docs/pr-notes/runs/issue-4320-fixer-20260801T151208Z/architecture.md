# Architecture

Bound to starting SHA `257b99bb38817e1fd5511710a5618d19ae48d7c3`.

Apply a dependency-only update. Firebase `12.17.0` satisfies the installed `@capacitor-firebase/*@8.3.0` peer range of `^12.6.0`. Regenerate lockfiles with npm and pnpm so Firebase's internal `@firebase/*` graph and integrity hashes remain authoritative.

The pnpm lock must update its importer, Firebase package and snapshot, and the peer-qualified keys for App Check, authentication, messaging, and performance. Initialization, authentication, and team-data access remain behind existing adapters. Performance is the largest direct web seam because it imports npm Firebase modules. The blast radius is dependency installation and the React/Capacitor bundle, with no configuration, rules, data, or backend migration.

Rollback is a single revert to the prior pins and generated lock graphs.
