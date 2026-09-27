import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { resolveAuthenticatedFamilyInviteEmail } = require('../../functions/family-invite-identity-core.cjs');

describe('family invite authenticated identity', () => {
    it('normalizes a verified signed token email without loading the Auth user', async () => {
        const getUser = vi.fn();

        await expect(resolveAuthenticatedFamilyInviteEmail({
            auth: { uid: 'parent-1', token: { email: ' Parent@Example.com ', email_verified: true } },
            getUser
        })).resolves.toBe('parent@example.com');
        expect(getUser).not.toHaveBeenCalled();
    });

    it('rejects an explicitly unverified signed token email without falling back', async () => {
        const getUser = vi.fn().mockResolvedValue({
            uid: 'parent-1',
            email: ' Parent@Example.com ',
            emailVerified: true
        });

        await expect(resolveAuthenticatedFamilyInviteEmail({
            auth: { uid: 'parent-1', token: { email: ' Parent@Example.com ', email_verified: false } },
            getUser
        })).resolves.toBe('');
        expect(getUser).not.toHaveBeenCalled();
    });

    it('rejects a token email when the verification claim is missing', async () => {
        const getUser = vi.fn();

        await expect(resolveAuthenticatedFamilyInviteEmail({
            auth: { uid: 'parent-1', token: { email: ' Parent@Example.com ' } },
            getUser
        })).resolves.toBe('');
        expect(getUser).not.toHaveBeenCalled();
    });

    it('falls back to a normalized verified Admin Auth email when the token has none', async () => {
        const getUser = vi.fn().mockResolvedValue({
            uid: 'parent-1',
            email: ' Parent@Example.com ',
            emailVerified: true
        });

        await expect(resolveAuthenticatedFamilyInviteEmail({
            auth: { uid: 'parent-1', token: {} },
            getUser
        })).resolves.toBe('parent@example.com');
        expect(getUser).toHaveBeenCalledWith('parent-1');
    });

    it('rejects an unverified Admin Auth email', async () => {
        const getUser = vi.fn().mockResolvedValue({
            uid: 'parent-1',
            email: ' Parent@Example.com ',
            emailVerified: false
        });

        await expect(resolveAuthenticatedFamilyInviteEmail({
            auth: { uid: 'parent-1', token: {} },
            getUser
        })).resolves.toBe('');
        expect(getUser).toHaveBeenCalledWith('parent-1');
    });

    it('returns no identity when Firebase Auth has no email', async () => {
        const getUser = vi.fn().mockResolvedValue({ uid: 'parent-1' });

        await expect(resolveAuthenticatedFamilyInviteEmail({
            auth: { uid: 'parent-1', token: {} },
            getUser,
            request: { authEmail: 'invited@example.com' },
            profile: { email: 'invited@example.com' }
        })).resolves.toBe('');
    });

    it('propagates Admin Auth lookup failures before redemption can start', async () => {
        const error = new Error('Auth unavailable');
        const getUser = vi.fn().mockRejectedValue(error);

        await expect(resolveAuthenticatedFamilyInviteEmail({
            auth: { uid: 'parent-1', token: {} },
            getUser
        })).rejects.toBe(error);
    });

    it('uses the signed token instead of a conflicting Admin Auth or caller email', async () => {
        const getUser = vi.fn().mockResolvedValue({ email: 'admin-record@example.com' });

        await expect(resolveAuthenticatedFamilyInviteEmail({
            auth: { uid: 'parent-1', token: { email: 'token@example.com', email_verified: true } },
            getUser,
            request: { authEmail: 'invited@example.com' },
            profile: { email: 'invited@example.com' }
        })).resolves.toBe('token@example.com');
        expect(getUser).not.toHaveBeenCalled();
    });
});
