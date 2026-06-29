# Architecture Notes

Root cause: `edit-roster.html` imports additional registration review helpers from `./js/db.js?v=76`, but the bulk AI smoke test's mocked db module did not export those helpers. ES module instantiation failed before the tab switching and roster image preview event listeners were registered, so uploading a file left `#roster-image-preview` hidden.

Decision: keep product code unchanged and update only the smoke test dependency stub to match the page's db import contract. This preserves the static-site module boundary and keeps the blast radius limited to the mocked CI harness.

Rollback: revert the smoke stub additions if the page stops importing those helpers.
