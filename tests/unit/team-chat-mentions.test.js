import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readTeamChat() {
    return readFileSync(new URL('../../team-chat.html', import.meta.url), 'utf8');
}

describe('team chat mention picker', () => {
    it('only opens for the supported ALL PLAYS mention target', () => {
        const html = readTeamChat();

        expect(html).toContain("const supportedMention = 'all plays';");
        expect(html).toContain('const normalizedQuery = query.toLowerCase();');
        expect(html).toContain('!supportedMention.startsWith(normalizedQuery)');
        expect(html).not.toContain("if (query.includes(' ') || query.length > 20)");
    });

    it('still inserts only the explicit ALL PLAYS assistant mention', () => {
        const html = readTeamChat();

        expect(html).toContain("const mentionText = '@ALL PLAYS ';");
        expect(html).toContain("document.getElementById('mention-allplays').addEventListener('click', insertMention);");
    });
});
