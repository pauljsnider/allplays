// @vitest-environment jsdom
import { act } from 'react';
import { fireEvent, render, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessTool } from './AccessTool';
import type { AuthState } from '../../lib/types';

const accessServiceMocks = vi.hoisted(() => ({
    loadParentAccessModel: vi.fn(),
    loadParentAccessTeam: vi.fn(),
    discoverParentAccessTeams: vi.fn(),
    loadParentAccessPlayers: vi.fn(),
    submitParentAccessRequest: vi.fn()
}));

vi.mock('../../lib/parentToolsAccessService', () => accessServiceMocks);
vi.mock('../../lib/inviteRedemption', () => ({ redeemSignedInInvite: vi.fn() }));
vi.mock('lucide-react', () => {
    const Icon = () => null;
    return { AlertCircle: Icon, CheckCircle2: Icon, KeyRound: Icon, Loader2: Icon, RefreshCw: Icon, Search: Icon, Shield: Icon, Users: Icon };
});

const auth = {
    user: { uid: 'parent-1', email: 'parent@example.com', displayName: 'Parent', roles: ['parent'], parentOf: [] },
    profile: {},
    loading: false,
    error: null,
    isParent: true,
    isCoach: false,
    isAdmin: false,
    isPlatformAdmin: false,
    refresh: async () => {},
    signOut: async () => {}
} as unknown as AuthState;

let navigate: (to: string) => void;
function NavCapture() {
    navigate = useNavigate();
    return null;
}

function renderTool(initialTeamId: string) {
    return render(
        <MemoryRouter initialEntries={[`/parent-tools/access?teamId=${initialTeamId}`]}>
            <NavCapture />
            <Routes>
                <Route path="/parent-tools/access" element={<AccessTool auth={auth} onAccessChanged={() => {}} />} />
            </Routes>
        </MemoryRouter>
    );
}

describe('AccessTool deep-link reconciliation (#3088)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        accessServiceMocks.loadParentAccessModel.mockResolvedValue({ requests: [] });
        accessServiceMocks.discoverParentAccessTeams.mockResolvedValue({
            teams: [
                { id: 'team-a', name: 'Team A' },
                { id: 'team-b', name: 'Team B' }
            ],
            nextCursor: null
        });
        accessServiceMocks.loadParentAccessTeam.mockImplementation(async (teamId: string) => {
            if (teamId === 'team-a') return { id: 'team-a', name: 'Team A' };
            if (teamId === 'team-b') return { id: 'team-b', name: 'Team B' };
            return null;
        });
        accessServiceMocks.loadParentAccessPlayers.mockResolvedValue([]);
    });

    afterEach(() => cleanup());

    it('opens the manual request form while deep-linked teams are still loading', async () => {
        let resolveTeams: (teams: Array<{ id: string; name: string }>) => void = () => {};
        accessServiceMocks.discoverParentAccessTeams.mockReturnValue(new Promise((resolve) => {
            resolveTeams = resolve;
        }));

        const view = renderTool('team-a');

        await waitFor(() => expect(accessServiceMocks.discoverParentAccessTeams).toHaveBeenCalledTimes(1));
        await waitFor(() => {
            const select = view.container.querySelector('#parent-access-team') as HTMLSelectElement | null;
            expect(select).not.toBeNull();
            expect(select?.disabled).toBe(true);
            expect(select?.textContent).toContain('Loading public teams...');
        });

        await act(async () => {
            resolveTeams({ teams: [{ id: 'team-a', name: 'Team A' }], nextCursor: null } as any);
        });
    });

    it('does not repeat initial discovery when a deep link returns an empty team page', async () => {
        accessServiceMocks.discoverParentAccessTeams.mockResolvedValue({ teams: [], nextCursor: null });
        accessServiceMocks.loadParentAccessTeam.mockResolvedValue(null);

        renderTool('team-z');

        await waitFor(() => expect(accessServiceMocks.discoverParentAccessTeams).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(accessServiceMocks.loadParentAccessTeam).toHaveBeenCalledWith('team-z'));
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(accessServiceMocks.discoverParentAccessTeams).toHaveBeenCalledTimes(1);
        expect(accessServiceMocks.loadParentAccessTeam).toHaveBeenCalledTimes(1);
    });

    it('does not repeat initial discovery when a deep-link browse rejects', async () => {
        accessServiceMocks.discoverParentAccessTeams.mockRejectedValue(new Error('Discovery unavailable'));
        accessServiceMocks.loadParentAccessTeam.mockResolvedValue(null);

        renderTool('team-z');

        await waitFor(() => expect(accessServiceMocks.discoverParentAccessTeams).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(accessServiceMocks.loadParentAccessTeam).toHaveBeenCalledWith('team-z'));
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(accessServiceMocks.discoverParentAccessTeams).toHaveBeenCalledTimes(1);
        expect(accessServiceMocks.loadParentAccessTeam).toHaveBeenCalledTimes(1);
    });

    it('switches to a newly deep-linked team while already mounted', async () => {
        renderTool('team-a');
        await waitFor(() => expect(accessServiceMocks.loadParentAccessPlayers).toHaveBeenCalledWith('team-a'));

        // Same mounted component, a different teamId opens (e.g. a second access
        // notification). The selection must follow the new deep link.
        await act(async () => {
            navigate('/parent-tools/access?teamId=team-b');
        });
        await waitFor(() => expect(accessServiceMocks.loadParentAccessPlayers).toHaveBeenCalledWith('team-b'));
    });

    it('clears the stale selection when the new deep-linked team is inaccessible', async () => {
        const view = renderTool('team-a');
        await waitFor(() => expect(accessServiceMocks.loadParentAccessPlayers).toHaveBeenCalledWith('team-a'));
        accessServiceMocks.loadParentAccessPlayers.mockClear();

        await act(async () => {
            navigate('/parent-tools/access?teamId=team-z');
        });

        // The previous team's roster must not remain selected (it could otherwise
        // submit a request against the wrong team).
        await waitFor(() => {
            const select = view.container.querySelector('#parent-access-team') as HTMLSelectElement | null;
            expect(select?.value).toBe('');
        });
        expect(accessServiceMocks.loadParentAccessPlayers).not.toHaveBeenCalledWith('team-z');
    });

    it('clears the prior team and player when an unmatched deep-link lookup rejects', async () => {
        let rejectTargetLookup: (reason?: unknown) => void = () => {};
        accessServiceMocks.loadParentAccessPlayers.mockResolvedValue([
            { id: 'player-a', name: 'Player A', number: '7' }
        ]);
        accessServiceMocks.loadParentAccessTeam.mockImplementation((teamId: string) => {
            if (teamId !== 'team-z') return Promise.resolve(null);
            return new Promise((_resolve, reject) => {
                rejectTargetLookup = reject;
            });
        });
        const view = renderTool('team-a');
        await waitFor(() => expect(accessServiceMocks.loadParentAccessPlayers).toHaveBeenCalledWith('team-a'));
        expect(await view.findByRole('option', { name: '#7 Player A' })).toBeTruthy();
        expect((view.getByLabelText('Team') as HTMLSelectElement).value).toBe('team-a');
        expect((view.getByLabelText('Player') as HTMLSelectElement).value).toBe('player-a');
        expect(view.getByRole('button', { name: 'Send request' })).not.toBeDisabled();

        await act(async () => {
            navigate('/parent-tools/access?teamId=team-z');
        });

        await waitFor(() => expect(accessServiceMocks.loadParentAccessTeam).toHaveBeenCalledWith('team-z'));
        await waitFor(() => {
            expect((view.getByLabelText('Team') as HTMLSelectElement).value).toBe('');
            expect((view.getByLabelText('Player') as HTMLSelectElement).value).toBe('');
            expect(view.getByRole('button', { name: 'Send request' })).toBeDisabled();
        });

        await act(async () => {
            rejectTargetLookup(new Error('Target lookup failed'));
        });

        expect(await view.findByText('Target lookup failed')).toBeTruthy();
        expect((view.getByLabelText('Team') as HTMLSelectElement).value).toBe('');
        expect((view.getByLabelText('Player') as HTMLSelectElement).value).toBe('');
        expect(view.getByRole('button', { name: 'Send request' })).toBeDisabled();
        expect(accessServiceMocks.submitParentAccessRequest).not.toHaveBeenCalled();
    });

    it('resolves a deep-linked team that is beyond the first discovery page', async () => {
        accessServiceMocks.discoverParentAccessTeams.mockResolvedValue({
            teams: [{ id: 'team-a', name: 'Team A' }],
            nextCursor: 'cursor-2'
        });
        accessServiceMocks.loadParentAccessTeam.mockResolvedValue({ id: 'team-z', name: 'Team Z' });

        renderTool('team-z');

        await waitFor(() => expect(accessServiceMocks.discoverParentAccessTeams).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(accessServiceMocks.loadParentAccessTeam).toHaveBeenCalledWith('team-z'));
        await waitFor(() => expect(accessServiceMocks.loadParentAccessPlayers).toHaveBeenCalledWith('team-z'));
    });

    it('reapplies the same deep link after the param is cleared', async () => {
        const view = renderTool('team-a');
        await waitFor(() => expect(accessServiceMocks.loadParentAccessPlayers).toHaveBeenCalledWith('team-a'));

        await act(async () => {
            navigate('/parent-tools/access');
        });
        await waitFor(() => expect(window.location.search).toBe(''));

        accessServiceMocks.loadParentAccessPlayers.mockClear();
        const teamSelect = view.container.querySelector('#parent-access-team') as HTMLSelectElement;
        fireEvent.change(teamSelect, { target: { value: 'team-b' } });
        await waitFor(() => expect(accessServiceMocks.loadParentAccessPlayers).toHaveBeenCalledWith('team-b'));

        accessServiceMocks.loadParentAccessPlayers.mockClear();

        await act(async () => {
            navigate('/parent-tools/access?teamId=team-a');
        });

        await waitFor(() => expect(accessServiceMocks.loadParentAccessPlayers).toHaveBeenCalledWith('team-a'));
    });
});

describe('AccessTool manual public team discovery', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        accessServiceMocks.loadParentAccessModel.mockResolvedValue({ requests: [] });
        accessServiceMocks.discoverParentAccessTeams.mockResolvedValue({
            teams: [{ id: 'team-a', name: 'Team A', sport: 'Soccer' }],
            nextCursor: null
        });
        accessServiceMocks.loadParentAccessTeam.mockResolvedValue(null);
        accessServiceMocks.loadParentAccessPlayers.mockResolvedValue([
            { id: 'player-a', name: 'Player A', number: '7' }
        ]);
    });

    afterEach(() => cleanup());

    it('waits for search or browse before loading public teams, then pages later results', async () => {
        accessServiceMocks.discoverParentAccessTeams
            .mockResolvedValueOnce({
                teams: [{ id: 'team-a', name: 'Austin Bats', sport: 'Soccer', city: 'Austin', state: 'TX' }],
                nextCursor: 'cursor-2'
            })
            .mockResolvedValueOnce({
                teams: [{ id: 'team-b', name: 'Austin Comets', zip: '73301' }],
                nextCursor: null
            });

        const view = renderTool('');

        await waitFor(() => expect(accessServiceMocks.loadParentAccessModel).toHaveBeenCalledTimes(1));
        fireEvent.click(view.getByRole('button', { name: 'Request access without a code' }));
        expect(accessServiceMocks.discoverParentAccessTeams).not.toHaveBeenCalled();
        expect(view.getByRole('option', { name: 'Search or browse teams' })).toBeTruthy();

        fireEvent.change(view.getByPlaceholderText('Team name, city, state, or zip'), { target: { value: 'Austin' } });
        fireEvent.click(view.getByRole('button', { name: 'Search' }));

        await waitFor(() => expect(accessServiceMocks.discoverParentAccessTeams).toHaveBeenCalledWith({ searchText: 'Austin', cursor: null, pageSize: 20 }));
        expect(await view.findByRole('option', { name: 'Austin Bats - Soccer - Austin, TX' })).toBeTruthy();
        expect(accessServiceMocks.loadParentAccessPlayers).not.toHaveBeenCalled();

        fireEvent.click(view.getByRole('button', { name: 'Load more teams' }));
        await waitFor(() => expect(accessServiceMocks.discoverParentAccessTeams).toHaveBeenLastCalledWith({ searchText: 'Austin', cursor: 'cursor-2', pageSize: 20 }));
        expect(await view.findByRole('option', { name: 'Austin Comets - 73301' })).toBeTruthy();

        fireEvent.change(view.getByLabelText('Team'), { target: { value: 'team-b' } });
        await waitFor(() => expect(accessServiceMocks.loadParentAccessPlayers).toHaveBeenCalledWith('team-b'));
    });

    it('clears team and player selection when the search text changes', async () => {
        const view = renderTool('');

        fireEvent.click(await view.findByRole('button', { name: 'Request access without a code' }));
        fireEvent.click(view.getByRole('button', { name: 'Browse' }));
        expect(await view.findByRole('option', { name: 'Team A - Soccer' })).toBeTruthy();

        fireEvent.change(view.getByLabelText('Team'), { target: { value: 'team-a' } });
        expect(await view.findByRole('option', { name: '#7 Player A' })).toBeTruthy();
        expect((view.getByLabelText('Team') as HTMLSelectElement).value).toBe('team-a');
        expect((view.getByLabelText('Player') as HTMLSelectElement).value).toBe('player-a');

        fireEvent.change(view.getByPlaceholderText('Team name, city, state, or zip'), { target: { value: 'Chicago' } });

        expect((view.getByLabelText('Team') as HTMLSelectElement).value).toBe('');
        expect((view.getByLabelText('Player') as HTMLSelectElement).value).toBe('');
        expect(view.getByRole('option', { name: 'Search or browse teams' })).toBeTruthy();
    });

    it('ignores stale team search results that resolve after a newer search', async () => {
        let resolveFirst: (value: unknown) => void = () => {};
        let resolveSecond: (value: unknown) => void = () => {};
        accessServiceMocks.discoverParentAccessTeams
            .mockReturnValueOnce(new Promise((resolve) => {
                resolveFirst = resolve;
            }))
            .mockReturnValueOnce(new Promise((resolve) => {
                resolveSecond = resolve;
            }));

        const view = renderTool('');

        fireEvent.click(await view.findByRole('button', { name: 'Request access without a code' }));
        fireEvent.change(view.getByPlaceholderText('Team name, city, state, or zip'), { target: { value: 'Bears' } });
        fireEvent.click(view.getByRole('button', { name: 'Search' }));
        fireEvent.change(view.getByPlaceholderText('Team name, city, state, or zip'), { target: { value: 'Lions' } });
        fireEvent.click(view.getByRole('button', { name: 'Search' }));

        await act(async () => {
            resolveSecond({ teams: [{ id: 'team-lions', name: 'Lions' }], nextCursor: null });
        });
        expect(await view.findByRole('option', { name: 'Lions' })).toBeTruthy();

        await act(async () => {
            resolveFirst({ teams: [{ id: 'team-bears', name: 'Bears' }], nextCursor: null });
        });

        expect(view.queryByRole('option', { name: 'Bears' })).toBeNull();
        expect(view.getByRole('option', { name: 'Lions' })).toBeTruthy();
    });

    it('ignores a pending team search when the query text changes before it resolves', async () => {
        let resolveSearch: (value: unknown) => void = () => {};
        accessServiceMocks.discoverParentAccessTeams.mockReturnValue(new Promise((resolve) => {
            resolveSearch = resolve;
        }));

        const view = renderTool('');

        fireEvent.click(await view.findByRole('button', { name: 'Request access without a code' }));
        fireEvent.change(view.getByPlaceholderText('Team name, city, state, or zip'), { target: { value: 'Bears' } });
        fireEvent.click(view.getByRole('button', { name: 'Search' }));
        fireEvent.change(view.getByPlaceholderText('Team name, city, state, or zip'), { target: { value: 'Lions' } });

        await act(async () => {
            resolveSearch({ teams: [{ id: 'team-bears', name: 'Bears' }], nextCursor: null });
        });

        expect(view.queryByRole('option', { name: 'Bears' })).toBeNull();
        expect(view.getByRole('option', { name: 'Search or browse teams' })).toBeTruthy();
    });
});
