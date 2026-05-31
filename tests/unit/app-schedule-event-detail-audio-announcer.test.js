import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readDetailSource() {
    return readFileSync(new URL('../../apps/app/src/pages/ScheduleEventDetail.tsx', import.meta.url), 'utf8');
}

describe('React app schedule event detail audio announcer wiring', () => {
    it('adds an audio announcement toggle to the play-by-play report section', () => {
        const source = readDetailSource();

        expect(source).toContain("import { useLiveGameAnnouncer } from '../lib/liveGameAnnouncer';");
        expect(source).toContain('const { supported, enabled, paused, toggleEnabled } = useLiveGameAnnouncer(plays);');
        expect(source).toContain('Audio announcements');
        expect(source).toContain('Turn on audio announcements');
        expect(source).toContain('Turn off audio announcements');
        expect(source).toContain('Hear each new play once while you keep this game open.');
        expect(source).toContain('Announcements pause automatically when the game is backgrounded.');
    });

    it('refreshes the game report while the plays tab stays open', () => {
        const source = readDetailSource();

        expect(source).toContain('const liveReportPollIntervalMs = 15000;');
        expect(source).toContain("if (activeReportSection !== 'plays') return undefined;");
        expect(source).toContain('const intervalId = window.setInterval(() => {');
        expect(source).toContain('void refreshReport(false);');
        expect(source).toContain('}, liveReportPollIntervalMs);');
    });
});
