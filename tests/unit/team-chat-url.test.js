import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readTeamChat() {
    return readFileSync(new URL('../../team-chat.html', import.meta.url), 'utf8');
}

function buildGetTeamIdFromUrl({ hash = '', search = '' } = {}) {
    const source = readTeamChat();
    const match = source.match(/function getTeamIdFromUrl\(\) \{([\s\S]*?)\n        \}\n\n        \/\/ Initialize/);
    expect(match, 'getTeamIdFromUrl should exist').toBeTruthy();

    const createHelper = new Function('deps', `
        const { window, URLSearchParams } = deps;
        return function() {
${match[1]}
        };
    `);

    return createHelper({
        window: { location: { hash, search } },
        URLSearchParams
    });
}

describe('team chat URL routing', () => {
    it('reads teamId from the existing hash route format', () => {
        const getTeamIdFromUrl = buildGetTeamIdFromUrl({ hash: '#teamId=team-123' });

        expect(getTeamIdFromUrl()).toBe('team-123');
    });

    it('reads teamId from notification query-string links', () => {
        const getTeamIdFromUrl = buildGetTeamIdFromUrl({ search: '?teamId=team-456' });

        expect(getTeamIdFromUrl()).toBe('team-456');
    });
});
