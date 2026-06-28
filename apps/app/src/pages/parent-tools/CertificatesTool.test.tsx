// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CertificatesTool } from './CertificatesTool';
import type { AuthState } from '../../lib/types';

const parentCertificatesServiceMocks = vi.hoisted(() => ({
    loadParentCertificates: vi.fn()
}));

vi.mock('../../lib/parentCertificatesService', () => ({
    loadParentCertificates: parentCertificatesServiceMocks.loadParentCertificates
}));

vi.mock('../../lib/publicActions', () => ({
    openPublicUrl: vi.fn(),
    sharePublicUrl: vi.fn()
}));

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
        expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Show all awards' }));

        expect(await screen.findByText('Leadership Award')).toBeTruthy();
    });

    it('falls back to the full list with an inline explanation when the requested certificate is missing', async () => {
        renderCertificatesTool('/parent-tools/certificates?teamId=team-1&certificateId=missing-cert');

        expect(await screen.findByText('Leadership Award')).toBeTruthy();
        expect(screen.getByText('That award is no longer available. Showing all published awards instead.')).toBeTruthy();
        expect(screen.getAllByText('Hustle Award').length).toBeGreaterThan(0);
    });
});
