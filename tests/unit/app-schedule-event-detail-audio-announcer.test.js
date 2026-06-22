import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('React app schedule event detail audio announcer wiring', () => {
    it('adds an audio announcement toggle to the play-by-play report section', () => {
        const source = readSource('apps/app/src/components/schedule/GameReportSectionContent.tsx');

        expect(source).toContain("import { useLiveGameAnnouncer } from '../../lib/liveGameAnnouncer';");
        expect(source).toContain('const { supported, enabled, paused, toggleEnabled } = useLiveGameAnnouncer(plays);');
        expect(source).toContain('Audio announcements');
        expect(source).toContain('Turn on audio announcements');
        expect(source).toContain('Turn off audio announcements');
        expect(source).toContain('Hear each new play once while you keep this game open.');
        expect(source).toContain('Announcements pause automatically when the game is backgrounded.');
    });

    it('only refreshes the game report automatically for live plays views', () => {
        const source = readSource('apps/app/src/components/schedule/GameReportSections.tsx');

        expect(source).toContain('const liveReportPollIntervalMs = 15000;');
        expect(source).toContain("const liveReportStatus = String(report?.game?.liveStatus || report?.game?.status || event.liveStatus || event.status || '').trim().toLowerCase();");
        expect(source).toContain("const isLivePlaysRefreshEnabled = activeReportSection === 'plays' && liveReportStatuses.has(liveReportStatus);");
        expect(source).toContain('if (!isLivePlaysRefreshEnabled) return undefined;');
        expect(source).toContain('const intervalId = window.setInterval(() => {');
        expect(source).toContain('void refreshReport(false);');
        expect(source).toContain("window.addEventListener('focus', handleFocus);");
        expect(source).toContain('}, liveReportPollIntervalMs);');
    });
});
