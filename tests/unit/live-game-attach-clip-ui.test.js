import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('live game attach clip UI', () => {
    it('renders staff-only attach clip controls for scored plays', () => {
        const js = readRepoFile('js/live-game.js');
        const html = readRepoFile('live-game.html');

        expect(js).toContain('hasFullTeamAccess');
        expect(js).toContain('canAttachScoreLinkedClips() && isScoredPlayEvent(event)');
        expect(js).toContain('data-attach-clip-event-id');
        expect(js).toContain('uploadGameClip(state.teamId, state.gameId, file)');
        expect(js).toContain('state.clipStartMs = null;');
        expect(js).toContain('clipEndMs: null');
        expect(html).toContain('id="attach-clip-modal"');
        expect(html).toContain('id="attach-clip-file" type="file" accept="video/*"');
        expect(html).toContain('id="attach-clip-url" type="url"');
    });
});
