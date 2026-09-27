// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
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

const staleCertificate = {
    ...requestedCertificate,
    id: 'stale-cert',
    title: 'Stale Award'
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

    it('ignores a deferred full-list completion after navigating to another award', async () => {
        let resolveStaleList!: (cards: typeof requestedCertificate[]) => void;
        parentCertificatesServiceMocks.loadParentCertificates.mockReturnValueOnce(new Promise((resolve) => {
            resolveStaleList = resolve;
        }));
        parentCertificatesServiceMocks.loadParentCertificate.mockImplementation(async (_user, _teamId, certificateId) => (
            certificateId === 'cert-2' ? leadershipCertificate : requestedCertificate
        ));

        render(
            <MemoryRouter initialEntries={['/parent-tools/certificates?teamId=team-1&certificateId=cert-1']}>
                <Link to="/parent-tools/certificates?teamId=team-2&certificateId=cert-2">Next award</Link>
                <Routes>
                    <Route path="/parent-tools/certificates" element={<CertificatesTool auth={auth} refreshVersion={0} />} />
                </Routes>
            </MemoryRouter>
        );

        expect(await screen.findByText('Hustle Award')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Show all awards' }));
        fireEvent.click(screen.getByRole('link', { name: 'Next award' }));
        expect(await screen.findByText('Leadership Award')).toBeTruthy();

        await act(async () => resolveStaleList([staleCertificate]));

        expect(screen.getByText('Leadership Award')).toBeTruthy();
        expect(screen.queryByText('Stale Award')).toBeNull();
    });

    it('ignores a deferred full-list completion after refreshVersion changes', async () => {
        let resolveStaleList!: (cards: typeof requestedCertificate[]) => void;
        parentCertificatesServiceMocks.loadParentCertificates.mockReturnValueOnce(new Promise((resolve) => {
            resolveStaleList = resolve;
        }));
        const refreshedCertificate = { ...requestedCertificate, title: 'Refreshed Award' };
        const view = render(
            <MemoryRouter initialEntries={['/parent-tools/certificates?teamId=team-1&certificateId=cert-1']}>
                <CertificatesTool auth={auth} refreshVersion={0} />
            </MemoryRouter>
        );

        expect(await screen.findByText('Hustle Award')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Show all awards' }));
        parentCertificatesServiceMocks.loadParentCertificate.mockResolvedValueOnce(refreshedCertificate);
        view.rerender(
            <MemoryRouter initialEntries={['/parent-tools/certificates?teamId=team-1&certificateId=cert-1']}>
                <CertificatesTool auth={auth} refreshVersion={1} />
            </MemoryRouter>
        );
        expect(await screen.findByText('Refreshed Award')).toBeTruthy();

        await act(async () => resolveStaleList([staleCertificate]));

        expect(screen.getByText('Refreshed Award')).toBeTruthy();
        expect(screen.queryByText('Stale Award')).toBeNull();
    });

    it('ignores a deferred full-list completion after the authenticated user changes', async () => {
        let resolveStaleList!: (cards: typeof requestedCertificate[]) => void;
        parentCertificatesServiceMocks.loadParentCertificates.mockReturnValueOnce(new Promise((resolve) => {
            resolveStaleList = resolve;
        }));
        const nextUserAuth: AuthState = {
            ...auth,
            user: { ...auth.user!, uid: 'parent-2', email: 'other-parent@example.com' }
        };
        const nextUserCertificate = { ...requestedCertificate, title: 'Other Parent Award' };
        const view = render(
            <MemoryRouter initialEntries={['/parent-tools/certificates?teamId=team-1&certificateId=cert-1']}>
                <CertificatesTool auth={auth} refreshVersion={0} />
            </MemoryRouter>
        );

        expect(await screen.findByText('Hustle Award')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Show all awards' }));
        parentCertificatesServiceMocks.loadParentCertificate.mockResolvedValueOnce(nextUserCertificate);
        view.rerender(
            <MemoryRouter initialEntries={['/parent-tools/certificates?teamId=team-1&certificateId=cert-1']}>
                <CertificatesTool auth={nextUserAuth} refreshVersion={0} />
            </MemoryRouter>
        );
        expect(await screen.findByText('Other Parent Award')).toBeTruthy();

        await act(async () => resolveStaleList([staleCertificate]));

        expect(screen.getByText('Other Parent Award')).toBeTruthy();
        expect(screen.queryByText('Stale Award')).toBeNull();
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
