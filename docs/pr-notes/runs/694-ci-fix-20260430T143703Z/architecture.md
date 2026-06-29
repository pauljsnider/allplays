# Architecture notes

Root cause: `edit-roster.html` now imports `./js/db.js?v=76` and `getRosterFieldDefinitions`, but the bulk AI smoke test dependency mock only intercepted `db.js?v=76`. The browser loaded the real Firebase-backed db module under the smoke harness, causing the module graph to fail before the roster image preview change handler was registered.

Decision: keep product code unchanged and make the smoke mock version-tolerant for `db.js` cache-busting query strings. Add the new `getRosterFieldDefinitions` export to the stub so the edit roster module can initialize without Firebase.

Blast radius: test-only. This restores hermetic static-hosting smoke coverage without changing runtime behavior.
