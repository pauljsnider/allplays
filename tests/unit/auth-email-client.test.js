import { beforeEach, describe, expect, it, vi } from 'vitest';

const callableMocks = vi.hoisted(() => ({
    queuePasswordResetEmail: vi.fn(),
    queueEmailVerification: vi.fn(),
    queueInviteSignInEmail: vi.fn()
}));

vi.mock('../../js/firebase.js?v=33', () => ({
    functions: { project: 'test' },
    httpsCallable: vi.fn((_functions, name) => callableMocks[name])
}));

import {
    queueCurrentUserVerificationEmail,
    queueInviteSignInEmail,
    queuePasswordResetEmail
} from '../../js/auth-email.js';

describe('Resend-backed authentication email client', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('normalizes password reset recipients', async () => {
        callableMocks.queuePasswordResetEmail.mockResolvedValue({ data: { queued: true } });

        await queuePasswordResetEmail(' Player@Example.COM ');

        expect(callableMocks.queuePasswordResetEmail).toHaveBeenCalledWith({ email: 'player@example.com' });
    });

    it('passes native Firebase ID tokens only to the verification callable', async () => {
        callableMocks.queueEmailVerification.mockResolvedValue({ data: { queued: true } });

        await queueCurrentUserVerificationEmail('native-id-token');

        expect(callableMocks.queueEmailVerification).toHaveBeenCalledWith({ idToken: 'native-id-token' });
    });

    it('passes an allowlisted verification continuation separately from the native token', async () => {
        callableMocks.queueEmailVerification.mockResolvedValue({ data: { queued: true } });
        const viewerRoute = '/live-game-diamond-v2.html?teamId=team%2Fone&gameId=game+one&replay=true';

        await queueCurrentUserVerificationEmail('native-id-token', viewerRoute);

        expect(callableMocks.queueEmailVerification).toHaveBeenCalledWith({
            idToken: 'native-id-token',
            next: viewerRoute
        });
    });

    it('normalizes invite codes for server-side ownership validation', async () => {
        callableMocks.queueInviteSignInEmail.mockResolvedValue({ data: { queued: true, existingUser: true } });

        const result = await queueInviteSignInEmail(' abcd1234 ');

        expect(callableMocks.queueInviteSignInEmail).toHaveBeenCalledWith({ code: 'ABCD1234' });
        expect(result.existingUser).toBe(true);
    });

    it('rejects callable responses that do not confirm queueing', async () => {
        callableMocks.queuePasswordResetEmail.mockResolvedValue({ data: { queued: false } });

        await expect(queuePasswordResetEmail('player@example.com')).rejects.toThrow(
            'Authentication email could not be queued.'
        );
    });
});
