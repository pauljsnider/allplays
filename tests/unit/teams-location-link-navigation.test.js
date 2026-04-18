import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const interactiveSelector = 'a, button, input, select, textarea, summary, [role="button"], [role="link"]';

function readTeamsPage() {
    return readFileSync(new URL('../../teams.html', import.meta.url), 'utf8');
}

function extractTeamCardClickHandler() {
    const source = readTeamsPage();
    const match = source.match(/cardEl\.addEventListener\('click',\s*(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{([\s\S]*?)\n\s*\}\);/);

    expect(match, 'team card click handler should exist').toBeTruthy();
    return {
        params: match[1],
        body: match[2]
    };
}

function buildTeamCardClickHandler({ href = 'http://example.com/teams.html', teamId = 'team-123' } = {}) {
    const { params, body } = extractTeamCardClickHandler();
    const window = {
        location: {
            href
        }
    };
    const cardEl = {
        dataset: {
            teamId
        }
    };

    const createHandler = new Function('context', `
        const window = context.window;
        const cardEl = context.cardEl;
        return ${params} => {
${body}
        };
    `);

    return {
        window,
        handler: createHandler({ window, cardEl })
    };
}

describe('teams page location link navigation', () => {
    it('navigates to the team page when the card body is clicked', () => {
        const { window, handler } = buildTeamCardClickHandler();

        handler({
            target: {
                closest: () => null
            }
        });

        expect(window.location.href).toBe('team.html#teamId=team-123');
    });

    it('does not navigate the current tab when the nested location link is clicked', () => {
        const { window, handler } = buildTeamCardClickHandler();
        const closest = (selector) => {
            if (selector === interactiveSelector) {
                return { tagName: 'A' };
            }
            return null;
        };

        expect(closest('article')).toBeNull();

        handler({
            target: {
                closest
            }
        });

        expect(window.location.href).toBe('http://example.com/teams.html');
    });
});
