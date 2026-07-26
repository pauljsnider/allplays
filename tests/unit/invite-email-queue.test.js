import { beforeEach, describe, expect, it, vi } from 'vitest';

const callable = vi.fn();
const httpsCallable = vi.fn(() => callable);

vi.mock('../../js/firebase.js?v=22', () => ({
    functions: {},
    httpsCallable
}));

describe('invite email queue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        callable.mockResolvedValue({ data: { queued: true, deduplicated: false } });
    });

    it('keeps the first delivery deterministic', async () => {
        const { queueInviteEmail } = await import('../../js/invite-email.js');

        await queueInviteEmail('abcd1234');

        expect(callable).toHaveBeenCalledWith({ code: 'ABCD1234' });
    });

    it('sends an idempotency key when explicitly resending', async () => {
        const { queueInviteEmail } = await import('../../js/invite-email.js');

        await queueInviteEmail('abcd1234', {
            forceNewDelivery: true,
            deliveryId: 'retry-request-1'
        });

        expect(callable).toHaveBeenCalledWith({
            code: 'ABCD1234',
            forceNewDelivery: true,
            deliveryId: 'retry-request-1'
        });
    });
});
