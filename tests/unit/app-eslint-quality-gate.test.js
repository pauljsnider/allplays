import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { filterChangedAppSourceFiles } from '../../scripts/lint-app-ci.mjs';

function readAppEslintConfig() {
    return readFileSync(new URL('../../apps/app/eslint.config.js', import.meta.url), 'utf8');
}

describe('React app ESLint quality gate', () => {
    it('keeps rules-of-hooks enforced and escalates dependency findings in changed source files', () => {
        const configSource = readAppEslintConfig();
        const ciLintSource = readFileSync(new URL('../../scripts/lint-app-ci.mjs', import.meta.url), 'utf8');
        const workflowSource = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

        expect(configSource).toContain("'react-hooks/rules-of-hooks': 'error'");
        expect(configSource).toContain("'react-hooks/exhaustive-deps': 'warn'");
        expect(ciLintSource).toContain("'react-hooks/exhaustive-deps:error'");
        expect(workflowSource).toContain('run: node scripts/lint-app-ci.mjs');
        expect(workflowSource).toContain('BASE_SHA: ${{ github.event.pull_request.base.sha || github.event.before }}');
    });

    it('strictly lints only changed React app TypeScript sources', () => {
        expect(filterChangedAppSourceFiles([
            'apps/app/src/pages/Messages.tsx',
            'apps/app/src/pages/messages/hooks/useChatMessages.ts',
            'apps/app/src/pages/Messages.tsx',
            'apps/app/src/styles.css',
            'tests/unit/app-eslint-quality-gate.test.js'
        ])).toEqual([
            'src/pages/Messages.tsx',
            'src/pages/messages/hooks/useChatMessages.ts'
        ]);
    });
});
