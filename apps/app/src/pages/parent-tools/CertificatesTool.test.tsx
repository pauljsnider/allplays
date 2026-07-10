// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CertificatesTool } from './CertificatesTool';
import type { AuthState } from '../../lib/types';

const parentCertificatesServiceMocks = vi.hoisted(() => ({
    loadParentCertificates: vi.fn()
}));
const publicActionMocks = vi.hoisted(() => ({
    openPublicUrl: vi.fn(),
    sharePublicUrl: vi.fn()
}));

vi.mock('../../lib/parentCertificatesService', () => ({
    loadParentCertificates: parentCertificatesServiceMocks.loadParentCertificates
}));

vi.mock('../../lib/publicActions', () => publicActionMocks);

vi.mock('lucide-react', () => {
    const Icon = () => null;
    return {
        AlertCircle: Icon,
        Award: Icon,
        CheckCircle2: Icon,
        ExternalLink: Icon,
        Loader2: Icon,
        RefreshCw: Icon,
        Share2: Icon
    };
});

const auth: AuthState = {
    user: {
        uid: 'parent-1',
        email: 'parent@example.com',
        displayName: 'Parent One',
        roles: ['parent'],
        parentOf: []
    },
    profile: null,
    loading: false,
    error: null,
    roles: ['parent'],
    isParent: true,
    isCoach: false,
    isAdmin: false,
    isPlatformAdmin: false,
    refresh: vi.fn().mockResolvedValue(null),
    signOut: vi.fn().mockResolvedValue(undefined)
};

function renderCertificatesTool(initialEntry = '/parent-tools/certificates') {
    return render(
        <MemoryRouter initialEntries={[initialEntry]}>
            <CertificatesTool auth={auth} refreshVersion={0} />
        </MemoryRouter>
    );
}

describe('CertificatesTool deep links', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        parentCertificatesServiceMocks.loadParentCertificates.mockResolvedValue([
            {
                id: 'cert-2',
                teamId: 'team-2',
                teamName: 'Falcons',
                playerId: 'player-2',
                playerName: 'Jordan Star',
                title: 'Leadership Award',
                narrative: 'Great teammate.',
                url: 'https://allplays.ai/certificates.html#teamId=team-2&certificateId=cert-2'
            },
            {
                id: 'cert-1',
                teamId: 'team-1',
                teamName: 'Bears',
                playerId: 'player-1',
                playerName: 'Sam Player',
                title: 'Hustle Award',
                narrative: 'Great effort.',
                url: 'https://allplays.ai/certificates.html#teamId=team-1&certificateId=cert-1'
            }
        ]);
    });

    it('shows the requested certificate first and lets parents expand back to the full list', async () => {
        renderCertificatesTool('/parent-tools/certificates?teamId=team-1&certificateId=cert-1');

        expect(await screen.findByText('Hustle Award')).toBeTruthy();
        expect(screen.queryByText('Leadership Award')).toBeNull();
        expect(screen.getByText('Opened from a notification')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Show all awards' })).toBeTruthy();
        const requestedCard = screen.getByText('Hustle Award').closest('section') as HTMLElement;
        const viewAward = within(requestedCard).getByRole('button', { name: 'View award' });
        const requestedShare = within(requestedCard).getByRole('button', { name: 'Share' });
        expect(viewAward.className).toContain('primary-button');
        expect(requestedShare.className).toContain('secondary-button');
        fireEvent.click(viewAward);
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://allplays.ai/certificates.html#teamId=team-1&certificateId=cert-1');
        expect(parentCertificatesServiceMocks.loadParentCertificates).toHaveBeenCalledWith(auth.user, {
            requestedTeamId: 'team-1',
            requestedCertificateId: 'cert-1'
        });

        fireEvent.click(screen.getByRole('button', { name: 'Show all awards' }));

        expect(await screen.findByText('Leadership Award')).toBeTruthy();
        expect(within(requestedCard).getByRole('button', { name: 'View award' })).toBeTruthy();
        expect(within(requestedCard).getByRole('button', { name: 'Share' })).toBeTruthy();
        const leadershipCard = screen.getByText('Leadership Award').closest('section') as HTMLElement;
        expect(within(leadershipCard).getByRole('button', { name: 'Open' })).toBeTruthy();
        expect(within(leadershipCard).getByRole('button', { name: 'Share' })).toBeTruthy();
    });

    it('falls back to the full list with an inline explanation when the requested certificate is missing', async () => {
        renderCertificatesTool('/parent-tools/certificates?teamId=team-1&certificateId=missing-cert');

        expect(await screen.findByText('Leadership Award')).toBeTruthy();
        expect(screen.getByText('That award is no longer available. Showing all published awards instead.')).toBeTruthy();
        expect(screen.getAllByText('Hustle Award').length).toBeGreaterThan(0);
    });

    it('renders multiple award cards from the same team', async () => {
        parentCertificatesServiceMocks.loadParentCertificates.mockResolvedValueOnce([
            {
                id: 'cert-1',
                teamId: 'team-1',
                teamName: 'Bears',
                playerId: 'player-1',
                playerName: 'Sam Player',
                title: 'Hustle Award',
                narrative: 'Great effort.',
                url: 'https://allplays.ai/certificates.html#teamId=team-1&certificateId=cert-1'
            },
            {
                id: 'cert-2',
                teamId: 'team-1',
                teamName: 'Bears',
                playerId: 'player-2',
                playerName: 'Jordan Star',
                title: 'Leadership Award',
                narrative: 'Great teammate.',
                url: 'https://allplays.ai/certificates.html#teamId=team-1&certificateId=cert-2'
            }
        ]);

        const { container } = renderCertificatesTool();
        const currentRender = within(container);

        expect(await currentRender.findByText('Hustle Award')).toBeTruthy();
        expect(currentRender.getByText('Leadership Award')).toBeTruthy();
        expect(currentRender.getByText('Sam Player - Bears')).toBeTruthy();
        expect(currentRender.getByText('Jordan Star - Bears')).toBeTruthy();
        expect(currentRender.getAllByRole('button', { name: 'Open' })).toHaveLength(2);
        expect(currentRender.queryByRole('button', { name: 'View award' })).toBeNull();
    });
});
