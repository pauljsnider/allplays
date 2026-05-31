# Architecture notes

Use Jest's `<rootDir>` token, where rootDir is `apps/app`, and map app imports that walk to the legacy repo `js/` directory back to `<rootDir>/../../js/$1`. This preserves the existing cross-app import architecture without coupling tests to a bot-specific checkout path.

Keep `testMatch` narrow for the PR intent, but ensure the named file is committed.
