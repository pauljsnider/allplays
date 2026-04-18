## Implementation Plan
1. Update `tests/unit/help-page-reference-integrity.test.js` to derive the repo root from `fileURLToPath(import.meta.url)` instead of `new URL().pathname`.
2. Keep the rest of the test logic unchanged.
3. Do not modify `help.html`, `help-page-reference.html`, or `tests/smoke/help-center.spec.js` for this comment.

## Candidate Test Files
- `tests/unit/help-page-reference-integrity.test.js`
- `tests/smoke/help-center.spec.js` for regression context only

## Minimal Patch Shape
```js
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, '../..');
```

## Risks
- Regex normalization only patches one common Windows path form.
- `fileURLToPath` is the intended Node ESM API and carries very low risk in test-only code.
- No product behavior risk because the patch is limited to a unit test helper.
