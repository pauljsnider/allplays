1. Current-State Read

`edit-roster.html` is a static HTML page with inline ES module logic. The roster image preview is local browser state only: the `change` listener on `#roster-image-input` reads the selected file with `FileReader`, sets `#roster-image-preview-img.src`, and removes `hidden` from `#roster-image-preview`.

The smoke failure where `#roster-image-preview` remains hidden after `uploadRosterImage` is most consistent with the page module not reaching listener registration. The DOM exists, so Playwright can set the file input, but the app-side `change` handler is not active. In this test, that usually means one of the Playwright route mocks drifted from the cache-busted imports in `edit-roster.html`, causing the real Firebase-backed module to load or a named ES module import to fail before the preview handler is registered.

Current relevant imports are `./js/db.js?v=76`, `./js/roster-profile-fields.js?v=1`, `./js/utils.js?v=8`, `./js/auth.js?v=38`, `./js/team-admin-banner.js`, `./js/team-access.js`, and Firebase vendor AI/app modules. The test already uses a version-tolerant regex for `db.js`, but exact route patterns for `utils.js` and `auth.js` remain brittle. Prior CI fixes for this same smoke area were caused by dependency/mock drift around `db.js` cache-busting and missing exports.

Local validation note: the targeted smoke command currently passes in this workspace (`npx playwright test tests/smoke/edit-roster-bulk-ai-reset.spec.js --config=playwright.smoke.config.js --reporter=line`, 2 passed). That supports the architecture read that the product preview path is sound and the CI failure is likely branch/test harness drift rather than a required production behavior change.

2. Proposed Design

Keep the fix in the smoke harness unless browser console evidence proves product code is broken.

Minimal direction:

- Make dependency route mocks version-tolerant for all cache-busted imports used by `edit-roster.html`, not only `db.js`.
- Ensure `DB_STUB` exports every named symbol imported by `edit-roster.html` on the PR branch.
- If `roster-profile-fields.js` changes again and becomes coupled to unmocked browser/Firebase state, add a focused test stub for that module. Otherwise leaving the real self-contained helper module is acceptable.
- Do not move or rewrite the preview logic. It is intentionally client-only and independent of Firebase.

The smallest coherent fix is to adjust `tests/smoke/edit-roster-bulk-ai-reset.spec.js` so the mocked module graph stays aligned with the HTML page’s current import contract. This preserves the smoke’s purpose: verify bulk AI image/text reset behavior without relying on Firebase, auth, or network services.

3. Files And Modules Touched

Expected implementation touch:

- `tests/smoke/edit-roster-bulk-ai-reset.spec.js`
  - Broaden route patterns for versioned imports such as `auth.js?v=N` and `utils.js?v=N`.
  - Keep `db.js` route regex version-tolerant.
  - Mirror any new named exports imported from `js/db.js`.

Affected source, read-only for this fix:

- `edit-roster.html`
  - Owns the roster image preview handler and bulk AI reset flow.
- `js/db.js`
  - Source module represented by `DB_STUB`.
- `js/auth.js`, `js/utils.js`, `js/team-access.js`, `js/team-admin-banner.js`
  - Page dependencies mocked by the smoke harness.
- `js/roster-profile-fields.js`
  - Roster field helper import used during page initialization.

4. Data/State Impacts

No persistent application data impact is expected. The failing behavior is limited to client/test state:

- selected file on `#roster-image-input`
- preview image `src`
- `hidden` class on `#roster-image-preview`
- bulk AI proposed-operation draft state
- reset behavior after cancel

No Firestore documents, Storage objects, roster records, team membership, or auth claims should change.

5. Security/Permissions Impacts

No runtime security impact if the fix remains in the smoke test. Keeping Firebase/auth dependencies mocked reduces CI blast radius and avoids accidental dependence on real tenant data, auth sessions, or networked Firebase services.

Production access boundaries remain unchanged: team access continues through existing auth/team checks and Firestore rules. Do not bypass admin/team access checks in product code to make the smoke pass.

6. Failure Modes And Mitigations

- Failure mode: another cache-bust bump causes an exact route mock to miss and loads real modules in CI.
  - Mitigation: use regex or glob patterns that allow optional `?v=N` for cache-busted app modules.

- Failure mode: `DB_STUB` misses a newly imported named export, aborting ES module evaluation before DOM listeners register.
  - Mitigation: compare `edit-roster.html` named imports with the stub exports whenever this smoke fails; add no-op test exports for unrelated database functions.

- Failure mode: broad mocks hide a real product regression.
  - Mitigation: treat this smoke as a focused UI-state test. If it fails after the mock graph is aligned, inspect browser console errors and add a targeted assertion that `#roster-image-preview-img[src^="data:image/png;base64,"]` appears after upload.

- Failure mode: the failure is a true async preview race rather than module abort.
  - Mitigation: only after console/import errors are ruled out, wait on the data URL attribute as the readiness condition instead of relying only on visibility timing.

Rollback: revert only the smoke-test mock changes. Since no production code or data model should change, rollback blast radius is limited to CI coverage for `tests/smoke/edit-roster-bulk-ai-reset.spec.js`.
