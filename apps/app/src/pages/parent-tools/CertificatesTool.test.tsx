// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CertificatesTool } from './CertificatesTool';
import type { AuthState } from '../../lib/types';

const parentCertificatesServiceMocks = vi.hoisted(() => ({
    loadParentCertificate: vi.fn(),
    loadParentCertificates: vi.fn()
}));
const publicActionMocks = vi.hoisted(() => ({
    openPublicUrl: vi.fn(),
    sharePublicUrl: vi.fn()
}));

vi.mock('../../lib/parentCertificatesService', () => parentCertificatesServiceMocks);
vi.mock('../../lib/publicActions', () => publicActionMocks);

vi.mock('lucide-react', () => {
    const Icon = () => null;
    return {
        AlertCircle: Icon,
        Award: Icon,
        CheckCircle2: Icon,
        Copy: Icon,
        ExternalLink: Icon,
        Link2: Icon,
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

const requestedCertificate = {
    id: 'cert-1',
    teamId: 'team-1',
    teamName: 'Bears',
    playerId: 'player-1',
    playerName: 'Sam Player',
    title: 'Hustle Award',
    narrative: 'Great effort.',
    url: 'https://allplays.ai/certificates.html#teamId=team-1&certificateId=cert-1'
};

const leadershipCertificate = {
    id: 'cert-2',
    teamId: 'team-2',
    teamName: 'Falcons',
    playerId: 'player-2',
    playerName: 'Jordan Star',
    title: 'Leadership Award',
    narrative: 'Great teammate.',
    url: 'https://allplays.ai/certificates.html#teamId=team-2&certificateId=cert-2'
};

function renderCertificatesTool(initialEntry = '/parent-tools/certificates') {
    return render(
        <MemoryRouter initialEntries={[initialEntry]}>
            <CertificatesTool auth={auth} refreshVersion={0} />
        </MemoryRouter>
    );
}

describe('CertificatesTool', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        parentCertificatesServiceMocks.loadParentCertificate.mockResolvedValue(requestedCertificate);
        parentCertificatesServiceMocks.loadParentCertificates.mockResolvedValue([
            requestedCertificate,
            leadershipCertificate
        ]);
    });

    it('renders the direct award before the deferred full list and loads that list once on demand', async () => {
        let resolveFullList!: (cards: typeof requestedCertificate[]) => void;
        parentCertificatesServiceMocks.loadParentCertificates.mockReturnValue(new Promise((resolve) => {
            resolveFullList = resolve;
        }));
        renderCertificatesTool('/parent-tools/certificates?teamId=team-1&certificateId=cert-1');

        expect(await screen.findByText('Hustle Award')).toBeTruthy();
        expect(screen.queryByText('Leadership Award')).toBeNull();
        expect(parentCertificatesServiceMocks.loadParentCertificate).toHaveBeenCalledWith(auth.user, 'team-1', 'cert-1');
        expect(parentCertificatesServiceMocks.loadParentCertificates).not.toHaveBeenCalled();
        expect(screen.getByText('Opened from a notification')).toBeTruthy();

        const requestedCard = screen.getByText('Hustle Award').closest('section') as HTMLElement;
        fireEvent.click(within(requestedCard).getByRole('button', { name: 'View award' }));
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith(requestedCertificate.url);
        fireEvent.click(within(requestedCard).getByRole('button', { name: 'Share' }));
        expect(publicActionMocks.sharePublicUrl).toHaveBeenCalledWith({
            title: 'Hustle Award',
            text: 'Sam Player award',
            url: requestedCertificate.url
        });

        const showAll = screen.getByRole('button', { name: 'Show all awards' });
        fireEvent.click(showAll);
        fireEvent.click(showAll);

        expect(parentCertificatesServiceMocks.loadParentCertificates).toHaveBeenCalledTimes(1);
        expect(parentCertificatesServiceMocks.loadParentCertificates).toHaveBeenCalledWith(auth.user, {
            includeCertificate: requestedCertificate
        });
        expect(screen.getByText('Hustle Award')).toBeTruthy();
        expect(screen.queryByText('Leadership Award')).toBeNull();

        resolveFullList([requestedCertificate, leadershipCertificate]);

        expect(await screen.findByText('Leadership Award')).toBeTruthy();
        expect(parentCertificatesServiceMocks.loadParentCertificate).toHaveBeenCalledTimes(1);
        expect(within(requestedCard).getByRole('button', { name: 'View award' })).toBeTruthy();
        expect(within(screen.getByText('Leadership Award').closest('section') as HTMLElement).getByRole('button', { name: 'Open' })).toBeTruthy();
    });

    it('falls back to the bounded full list with an explanation when the direct award is unavailable', async () => {
        parentCertificatesServiceMocks.loadParentCertificate.mockResolvedValueOnce(null);
        renderCertificatesTool('/parent-tools/certificates?teamId=team-1&certificateId=missing-cert');

        expect(await screen.findByText('Leadership Award')).toBeTruthy();
        expect(screen.getByText('That award is no longer available. Showing all published awards instead.')).toBeTruthy();
        expect(parentCertificatesServiceMocks.loadParentCertificate).toHaveBeenCalledWith(auth.user, 'team-1', 'missing-cert');
        expect(parentCertificatesServiceMocks.loadParentCertificates).toHaveBeenCalledTimes(1);
        expect(parentCertificatesServiceMocks.loadParentCertificates).toHaveBeenCalledWith(auth.user);
    });

    it('retains normal bounded list rendering without a deep link', async () => {
        renderCertificatesTool();

        expect(await screen.findByText('Hustle Award')).toBeTruthy();
        expect(screen.getByText('Leadership Award')).toBeTruthy();
        expect(parentCertificatesServiceMocks.loadParentCertificate).not.toHaveBeenCalled();
        expect(parentCertificatesServiceMocks.loadParentCertificates).toHaveBeenCalledTimes(1);
        expect(parentCertificatesServiceMocks.loadParentCertificates).toHaveBeenCalledWith(auth.user);
        expect(screen.getAllByRole('button', { name: 'Open' })).toHaveLength(2);
        expect(screen.queryByRole('button', { name: 'View award' })).toBeNull();
    });
});
