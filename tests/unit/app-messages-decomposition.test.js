import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();

function readRepoFile(path) {
    return readFileSync(join(repoRoot, path), 'utf8');
}

describe('Messages page decomposition', () => {
    it('keeps chat data loading and email composer state in focused modules', () => {
        const source = readRepoFile('apps/app/src/pages/Messages.tsx');

        expect(source).toContain("from './messages/hooks/useChatSheets'");
        expect(source).toContain("from './messages/hooks/useChatTeam'");
        expect(source).toContain("from './messages/hooks/useChatMessages'");
        expect(source).toContain("from './messages/state/emailReducer'");
        expect(source).toContain('useReducer(emailReducer, initialEmailComposerState)');
    });

    it('keeps split Messages modules covered by focused unit tests', () => {
        [
            'apps/app/src/pages/messages/hooks/useChatSheets.test.tsx',
            'apps/app/src/pages/messages/hooks/__tests__/useChatTeam.test.tsx',
            'apps/app/src/pages/messages/hooks/__tests__/useChatMessages.test.tsx',
            'apps/app/src/pages/messages/state/__tests__/emailReducer.test.ts'
        ].forEach((path) => {
            expect(readRepoFile(path).length).toBeGreaterThan(0);
        });
    });
});
