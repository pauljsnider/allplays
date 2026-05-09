import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('parent dashboard practice session cancellation wiring', () => {
    it('uses the shared practice session visibility helper in schedule and packet flows', () => {
        const html = readRepoFile('parent-dashboard.html');

        expect(html).toContain("from './js/parent-dashboard-practice-sessions.js");
        expect(html).toContain('filterVisiblePracticeSessions(practiceSessions, dbGames)');
        expect(html).toContain('filterVisiblePracticeSessions(sessions || [], dbGames)');
    });

    it('does not drop standalone sessions before fallback schedule rendering', () => {
        const html = readRepoFile('parent-dashboard.html');

        expect(html).not.toContain('if (!session?.eventId) return;');
        expect(html).toContain('if (session?.eventId) {\n                        sessionsByEventId.set(session.eventId, session);\n                    }');
    });
});
