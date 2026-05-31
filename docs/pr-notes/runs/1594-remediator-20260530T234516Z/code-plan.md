# Code plan

1. Edit `apps/app/jest.config.cjs` to replace absolute legacy `js/` mapper paths with `<rootDir>/../../js/$1`.
2. Add `apps/app/src/lib/__tests__/chatService.test.ts` because `testMatch` points to that exact committed file.
3. Make the test assert the Jest config remains portable and the configured test target exists.
4. Run focused app test/build validation, then commit only the scoped remediation files.
