import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('live game legacy adapter boundary', () => {
    it('keeps live game workflow services behind typed legacy adapters', () => {
        const liveGameChatServiceSource = readFileSync('apps/app/src/lib/liveGameChatService.ts', 'utf8');
        const liveGameReactionsServiceSource = readFileSync('apps/app/src/lib/liveGameReactionsService.ts', 'utf8');
        const gameReportServiceSource = readFileSync('apps/app/src/lib/gameReportService.ts', 'utf8');
        const gameWrapupServiceSource = readFileSync('apps/app/src/lib/gameWrapupService.ts', 'utf8');

        expect(liveGameChatServiceSource).not.toContain('../../../../js/');
        expect(liveGameChatServiceSource).toContain('./adapters/legacyLiveGameChat');

        expect(liveGameReactionsServiceSource).not.toContain('../../../../js/');
        expect(liveGameReactionsServiceSource).toContain('./adapters/legacyLiveGameReactions');

        expect(gameReportServiceSource).not.toContain('../../../../js/');
        expect(gameReportServiceSource).toContain('./adapters/legacyGameReport');

        expect(gameWrapupServiceSource).not.toContain('../../../../js/');
        expect(gameWrapupServiceSource).toContain('./adapters/legacyGameWrapup');
    });

    it('keeps live game adapter modules on the shared legacy alias boundary', () => {
        const liveGameChatAdapterSource = readFileSync('apps/app/src/lib/adapters/legacyLiveGameChat.ts', 'utf8');
        const liveGameReactionsAdapterSource = readFileSync('apps/app/src/lib/adapters/legacyLiveGameReactions.ts', 'utf8');
        const gameReportAdapterSource = readFileSync('apps/app/src/lib/adapters/legacyGameReport.ts', 'utf8');
        const gameWrapupAdapterSource = readFileSync('apps/app/src/lib/adapters/legacyGameWrapup.ts', 'utf8');

        expect(liveGameChatAdapterSource).not.toContain('../../../../../js/');
        expect(liveGameChatAdapterSource).toContain('@legacy/db.js');
        expect(liveGameChatAdapterSource).toContain('@legacy/live-game-chat.js');

        expect(liveGameReactionsAdapterSource).not.toContain('../../../../../js/');
        expect(liveGameReactionsAdapterSource).toContain('@legacy/db.js');
        expect(liveGameReactionsAdapterSource).toContain('@legacy/live-game-chat.js');

        expect(gameReportAdapterSource).not.toContain('../../../../../js/');
        expect(gameReportAdapterSource).toContain('@legacy/db.js');
        expect(gameReportAdapterSource).toContain('@legacy/firebase.js');

        expect(gameWrapupAdapterSource).not.toContain('../../../../../js/');
        expect(gameWrapupAdapterSource).toContain('@legacy/db.js');
        expect(gameWrapupAdapterSource).toContain('@legacy/game-day-wrapup.js');
    });
});
