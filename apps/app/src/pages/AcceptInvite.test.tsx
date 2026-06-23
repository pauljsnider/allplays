// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { HashRouter, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AcceptInvite } from './AcceptInvite';
import type { AuthState } from '../lib/types';

const authServiceMocks = vi.hoisted(() => ({
    clearPendingInvite: vi.fn(),
    completeEmailLink: vi.fn(),
    isEmailLink: vi.fn(() => false),
    mapLegacyRedirectToAppRoute: vi.fn(() => '/home'),
    readPendingInvite: vi.fn(() => ({ code: '', type: '' })),
    redeemInviteForUser: vi.fn(),
    rememberPendingInvite: vi.fn()
}));

const inviteRedemptionMocks = vi.hoisted(() => ({
    getValidatedInviteCode: vi.fn((code: string) => String(code || '').trim().toUpperCase()),
    normalizeInviteCode: vi.fn((code: string) => String(code || '').trim().toUpperCase()),
    redeemSignedInInvite: vi.fn()
}));

vi.mock('../lib/authService', () => authServiceMocks);
vi.mock('../lib/inviteRedemption', () => inviteRedemptionMocks);

const auth: AuthState = {
    user: {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent',
        emailVerified: false,
        roles: ['parent']
    },
    profile: null,
    loading: false,
    error: null,
    roles: ['parent'],
    isParent: true,
    isCoach: false,
    isAdmin: false,
    isPlatformAdmin: false,
    refresh: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined)
};

function renderAcceptInvite() {
    return render(
        <MemoryRouter initialEntries={['/accept-invite?code=ABCDEFGH&type=parent']}>
            <Routes>
                <Route path="/accept-invite" element={<AcceptInvite auth={auth} />} />
                <Route path="/home" element={<div>Home route</div>} />
            </Routes>
        </MemoryRouter>
    );
}

function renderAcceptInviteHashRoute() {
    window.location.hash = '#/accept-invite?code=ABCDEFGH&type=parent';

    return render(
        <HashRouter>
            <Routes>
                <Route path="/accept-invite" element={<AcceptInvite auth={auth} />} />
                <Route path="/reset-password" element={<div>Reset route</div>} />
                <Route path="/home" element={<div>Home route</div>} />
            </Routes>
        </HashRouter>
    );
}

describe('AcceptInvite', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        inviteRedemptionMocks.redeemSignedInInvite.mockResolvedValue({
            code: 'ABCDEFGH',
            redirectPath: '/home',
            message: 'Invite accepted.'
        });
    });

    afterEach(() => {
        cleanup();
        window.location.hash = '';
    });

    it('shows signed-in invite success before redirecting to the destination route', async () => {
        renderAcceptInvite();

        expect(await screen.findByText('Invite accepted.')).toBeTruthy();
        expect(screen.queryByText('Home route')).toBeNull();

        await new Promise((resolve) => setTimeout(resolve, 750));

        expect(await screen.findByText('Home route')).toBeTruthy();
        expect(inviteRedemptionMocks.redeemSignedInInvite).toHaveBeenCalledWith({
            userId: 'user-1',
            code: 'ABCDEFGH',
            email: 'parent@example.com',
            refresh: auth.refresh
        });
    });

    it('does not apply the delayed success redirect after leaving the invite route', async () => {
        renderAcceptInviteHashRoute();

        expect(await screen.findByText('Invite accepted.')).toBeTruthy();

        window.location.hash = '#/reset-password?mode=resetPassword&oobCode=valid-code';
        window.dispatchEvent(new Event('hashchange'));

        expect(await screen.findByText('Reset route')).toBeTruthy();

        await new Promise((resolve) => setTimeout(resolve, 750));

        expect(screen.getByText('Reset route')).toBeTruthy();
        expect(screen.queryByText('Home route')).toBeNull();
    });
});
