// @vitest-environment jsdom
import { act } from 'react';
import { render, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessTool } from './AccessTool';
import type { AuthState } from '../../lib/types';

const accessServiceMocks = vi.hoisted(() => ({
    loadParentAccessModel: vi.fn(),
    loadParentAccessTeams: vi.fn(),
    loadParentAccessPlayers: vi.fn(),
    submitParentAccessRequest: vi.fn()
}));

vi.mock('../../lib/parentToolsAccessService', () => accessServiceMocks);
vi.mock('../../lib/inviteRedemption', () => ({ redeemSignedInInvite: vi.fn() }));
vi.mock('lucide-react', () => {
    const Icon = () => null;
    return { AlertCircle: Icon, CheckCircle2: Icon, KeyRound: Icon, Loader2: Icon, RefreshCw: Icon, Shield: Icon, Users: Icon };
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
        accessServiceMocks.loadParentAccessTeams.mockResolvedValue([
            { id: 'team-a', name: 'Team A' },
            { id: 'team-b', name: 'Team B' }
        ]);
        accessServiceMocks.loadParentAccessPlayers.mockResolvedValue([]);
    });

    afterEach(() => cleanup());

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
});
