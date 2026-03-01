import { describe, it, expect, vi } from 'vitest';
import { executeEmailPasswordSignup } from '../../js/signup-flow.js';

function createDependencies(overrides = {}) {
    return {
        validateAccessCode: vi.fn().mockResolvedValue({
            valid: true,
            type: 'parent_invite',
            data: { code: 'PARENTCODE' }
        }),
        createUserWithEmailAndPassword: vi.fn().mockResolvedValue({
            user: { uid: 'user-123' }
        }),
        redeemParentInvite: vi.fn().mockResolvedValue(undefined),
        updateUserProfile: vi.fn().mockResolvedValue(undefined),
        markAccessCodeAsUsed: vi.fn().mockResolvedValue(undefined),
        sendEmailVerification: vi.fn().mockResolvedValue(undefined),
        ...overrides
    };
}

describe('executeEmailPasswordSignup', () => {
    it('throws when parent invite linking fails so signup does not report success', async () => {
        const expectedError = new Error('temporary backend failure');
        const dependencies = createDependencies({
            redeemParentInvite: vi.fn().mockRejectedValue(expectedError)
        });
        const auth = {
            currentUser: {
                email: 'parent@example.com',
                reload: vi.fn().mockResolvedValue(undefined)
            }
        };

        await expect(executeEmailPasswordSignup({
            email: 'parent@example.com',
            password: 'password123',
            activationCode: 'PARENTCODE',
            auth,
            dependencies
        })).rejects.toThrow('temporary backend failure');

        expect(dependencies.updateUserProfile).not.toHaveBeenCalled();
        expect(dependencies.sendEmailVerification).not.toHaveBeenCalled();
    });

    it('completes parent invite signup and sends verification when linking succeeds', async () => {
        const dependencies = createDependencies();
        const reload = vi.fn().mockResolvedValue(undefined);
        const auth = {
            currentUser: {
                email: 'parent@example.com',
                reload
            }
        };

        const result = await executeEmailPasswordSignup({
            email: 'parent@example.com',
            password: 'password123',
            activationCode: 'PARENTCODE',
            auth,
            dependencies
        });

        expect(result.user.uid).toBe('user-123');
        expect(dependencies.redeemParentInvite).toHaveBeenCalledWith('user-123', 'PARENTCODE');
        expect(dependencies.updateUserProfile).toHaveBeenCalledTimes(1);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(dependencies.sendEmailVerification).toHaveBeenCalledTimes(1);
    });
});
