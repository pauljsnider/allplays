import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readAppEslintConfig() {
    return readFileSync(new URL('../../apps/app/eslint.config.js', import.meta.url), 'utf8');
}

describe('React app ESLint quality gate', () => {
    it('keeps rules-of-hooks enforced even when lint runs with --quiet', () => {
        const source = readAppEslintConfig();

        expect(source).toContain("'react-hooks/rules-of-hooks': 'error'");
        expect(source).toContain("'react-hooks/exhaustive-deps': 'warn'");
    });
});
