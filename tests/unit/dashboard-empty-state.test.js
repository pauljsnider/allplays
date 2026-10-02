import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

function readDashboardSource() {
    return readFileSync(new URL('../../dashboard.html', import.meta.url), 'utf8');
}

function extractFunction(source, functionName, nextFunctionName) {
    const start = source.indexOf(`function ${functionName}(`);
    const nextFunction = new RegExp(`(?:async\\s+)?function ${nextFunctionName}\\(`);
    const offset = source.slice(start).search(nextFunction);
    const end = offset === -1 ? -1 : start + offset;
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

    it.each([false, true])('renders zero-team onboarding before mapping, with more pages: %s', (hasMoreTeams) => {
        const loadMoreButton = { addEventListener: vi.fn() };
        const container = {
            innerHTML: '',
            querySelector: vi.fn(() => hasMoreTeams ? loadMoreButton : null)
        };
        const renderNoTeamsState = vi.fn(() => '<section>No Teams Yet</section>');
        const renderTeamCard = vi.fn(() => { throw new Error('Empty teams must not render cards'); });
        const attachDeleteHandlers = vi.fn();
        const loadMoreTeams = vi.fn();
        const renderTeamLists = new Function(
            '{ user, hasMoreTeams, loadMoreTeamsInProgress, loadMoreTeamsError, fullAccessTeams, parentOnlyTeams, container, renderNoTeamsState, renderTeamCard, attachDeleteHandlers, loadMoreTeams }',
            `${extractFunction(source, 'renderTeamLists', 'loadMoreTeams')}; return renderTeamLists;`
        )({
            user: { isAdmin: true }, hasMoreTeams, loadMoreTeamsInProgress: false, loadMoreTeamsError: '',
            fullAccessTeams: [], parentOnlyTeams: [], container, renderNoTeamsState, renderTeamCard,
            attachDeleteHandlers, loadMoreTeams
        });

        renderTeamLists();

        expect(renderNoTeamsState).toHaveBeenCalledOnce();
        expect(container.innerHTML).toContain('No Teams Yet');
        expect(renderTeamCard).not.toHaveBeenCalled();
        expect(attachDeleteHandlers).not.toHaveBeenCalled();
        if (hasMoreTeams) {
            expect(container.innerHTML).toContain('id="load-more-teams"');
            expect(loadMoreButton.addEventListener).toHaveBeenCalledWith('click', loadMoreTeams);
        } else {
            expect(container.innerHTML).not.toContain('id="load-more-teams"');
        }

        const renderTeamCardSource = extractFunction(source, 'renderTeamCard', 'attachDeleteHandlers');
        expect(renderTeamCardSource).not.toContain('No Teams Yet');
        expect(renderTeamCardSource).not.toContain('fullAccessTeams.length === 0');
    });
});
