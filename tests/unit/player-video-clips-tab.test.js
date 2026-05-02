import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readPlayerPage() {
    return readFileSync(new URL('../../player.html', import.meta.url), 'utf8');
}

describe('player video clips tab', () => {
    it('wires Video Clips into the existing player profile tab navigation', () => {
        const html = readPlayerPage();

        expect(html).toContain('id="tab-clips"');
        expect(html).toContain('Video Clips');
        expect(html).toContain('id="content-clips"');
        expect(html).toContain("const tabs = ['games', 'season', 'events', 'clips'];");
    });

    it('renders an empty state for clips without changing existing tab content', () => {
        const html = readPlayerPage();

        expect(html).toContain('No video clips yet');
        expect(html).toContain('Player clips will appear here after scored streamed games are processed.');
        expect(html).toContain('id="content-games"');
        expect(html).toContain('id="content-season"');
        expect(html).toContain('id="content-events"');
    });
});
