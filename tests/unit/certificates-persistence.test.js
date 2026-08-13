import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    callable: vi.fn(),
    httpsCallable: vi.fn()
}));

vi.mock('../../js/firebase.js?v=24', () => ({
    functions: { name: 'functions' },
    httpsCallable: mocks.httpsCallable
}));

describe('certificate defaults persistence', () => {
    beforeEach(() => {
        mocks.callable.mockReset();
        mocks.httpsCallable.mockReset();
        mocks.httpsCallable.mockReturnValue(mocks.callable);
    });

    it('routes shared defaults through the authorized server cleanup boundary', async () => {
        const defaults = {
            signers: [{
                signatureImageUrl: 'https://img.example/new.png',
                signatureImagePath: 'certificate-signatures/teams/team-1/new.png'
            }]
        };
        mocks.callable.mockResolvedValue({ data: { success: true, defaults } });
        const { commitCertificateDefaults } = await import('../../js/certificates/persistence.js');

        await expect(commitCertificateDefaults('team-1', defaults)).resolves.toEqual(defaults);
        expect(mocks.httpsCallable).toHaveBeenCalledWith({ name: 'functions' }, 'commitCertificateDefaults');
        expect(mocks.callable).toHaveBeenCalledWith({ teamId: 'team-1', defaults });
    });

    it('rejects a missing team before calling the backend', async () => {
        const { commitCertificateDefaults } = await import('../../js/certificates/persistence.js');

        await expect(commitCertificateDefaults('', {})).rejects.toThrow('Missing team');
        expect(mocks.httpsCallable).not.toHaveBeenCalled();
    });
});
