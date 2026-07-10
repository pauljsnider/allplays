import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readDashboardSource() {
    return readFileSync(new URL('../../dashboard.html', import.meta.url), 'utf8');
}

function extractFunction(source, functionName, nextFunctionName) {
    const start = source.indexOf(`function ${functionName}(`);
    const end = source.indexOf(`function ${nextFunctionName}(`, start);
    if (start === -1 || end === -1) throw new Error(`Unable to extract ${functionName}`);
    return source.slice(start, end);
}

describe('dashboard zero-team onboarding state', () => {
    const source = readDashboardSource();

    it('renders the intended onboarding card and create-team destination', () => {
        const functionSource = extractFunction(source, 'renderNoTeamsState', 'renderTeamCard');
        const renderNoTeamsState = new Function(`${functionSource}; return renderNoTeamsState;`)();
        const html = renderNoTeamsState();

        expect(html).toContain('No Teams Yet');
        expect(html).toContain('Create Your First Team');
        expect(html).toContain('href="edit-team.html"');
    });

    it('handles zero full-access and parent-only teams before list mapping', () => {
        expect(source).toContain(`if (fullAccessTeams.length === 0 && parentOnlyTeams.length === 0) {
                    container.innerHTML = renderNoTeamsState();
                } else if (fullAccessTeams.length === 0 && parentOnlyTeams.length > 0) {`);

        const renderTeamCardSource = extractFunction(source, 'renderTeamCard', 'attachDeleteHandlers');
        expect(renderTeamCardSource).not.toContain('No Teams Yet');
        expect(renderTeamCardSource).not.toContain('fullAccessTeams.length === 0');
    });
});
