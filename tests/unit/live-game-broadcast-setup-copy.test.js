import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const liveGameHtml = readFileSync(new URL('../../live-game.html', import.meta.url), 'utf8');
const liveGameJs = readFileSync(new URL('../../js/live-game.js', import.meta.url), 'utf8');

describe('live game camera setup copy', () => {
    it('labels the native camera flow as setup and preview only', () => {
        expect(liveGameHtml).toContain('Camera/Mic Setup');
        expect(liveGameHtml).toContain('Preview only');
        expect(liveGameHtml).toContain('Start Camera/Mic Setup');
        expect(liveGameHtml).toContain('This does not start streaming.');
    });

    it('does not describe camera permission setup as starting or enabling streaming', () => {
        const copySurface = `${liveGameHtml}\n${liveGameJs}`;

        expect(copySurface).not.toContain('Start Broadcast Setup');
        expect(copySurface).not.toContain('marked stream-ready');
        expect(copySurface).not.toContain('ready for a future managed stream');
        expect(copySurface).not.toMatch(/mark the game ready/i);
        expect(copySurface).toContain('no live ingest, recording, or stream starts yet');
    });
});
