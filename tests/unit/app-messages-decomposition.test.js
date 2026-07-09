import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();

function readRepoFile(path) {
    return readFileSync(join(repoRoot, path), 'utf8');
}

describe('Messages page decomposition', () => {
    it('keeps chat data loading and email composer state in focused modules', () => {
        const messagesSource = readRepoFile('apps/app/src/pages/Messages.tsx');
        const chatWindowSource = readRepoFile('apps/app/src/pages/messages/components/ChatWindow.tsx');
        const teamEmailSheetSource = readRepoFile('apps/app/src/pages/messages/components/TeamEmailSheet.tsx');
        const source = [messagesSource, chatWindowSource, teamEmailSheetSource].join('\n');

        expect(source).toContain("from '../hooks/useChatSheets'");
        expect(source).toContain("from '../hooks/useChatTeam'");
        expect(source).toContain("from '../hooks/useChatMessages'");
        expect(chatWindowSource).toContain("lazy(() => import('./TeamEmailSheet'))");
        expect(chatWindowSource).not.toContain("from '../state/emailReducer'");
        expect(teamEmailSheetSource).toContain("from '../state/emailReducer'");
        expect(teamEmailSheetSource).toContain('useReducer(emailReducer, initialEmailComposerState)');
    });

    it('keeps split Messages modules covered by focused unit tests', () => {
        [
            'apps/app/src/pages/messages/hooks/useChatSheets.test.tsx',
            'apps/app/src/pages/messages/hooks/__tests__/useChatTeam.test.tsx',
            'apps/app/src/pages/messages/hooks/__tests__/useChatMessages.test.tsx',
            'apps/app/src/pages/messages/state/__tests__/emailReducer.test.ts'
        ].forEach((path) => {
            expect(readRepoFile(path)).toMatch(/\b(describe|it|test)\s*\(/);
        });
    });
});
