Validation target:
- Confirm the workflow remains syntactically valid after the change.
- Confirm the comment step reads the deploy output deterministically.

Manual verification focus:
- On a same-repo PR run, the deploy step should emit JSON to a file and export the preview URL.
- The GitHub Script step should create or update a PR comment containing the preview URL.

Risk notes:
- If Firebase CLI output shape changes, the comment step would fail to find the URL.
- The deploy job already depends on successful authentication and preview deploy completion, so the added blast radius is low.
