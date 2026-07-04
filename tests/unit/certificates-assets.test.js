import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    requireImageAuth: vi.fn(),
    uploadBytes: vi.fn(),
    getDownloadURL: vi.fn(),
    addDoc: vi.fn(),
    collection: vi.fn(),
    ref: vi.fn()
}));

vi.mock('../../js/firebase-images.js?v=9', () => ({
    imageStorage: {},
    requireImageAuth: mocks.requireImageAuth
}));

vi.mock('../../js/firebase.js?v=20', () => ({
    db: {},
    collection: mocks.collection,
    addDoc: mocks.addDoc,
    Timestamp: { now: () => ({ seconds: 1 }) },
    ref: mocks.ref,
    uploadBytes: mocks.uploadBytes,
    getDownloadURL: mocks.getDownloadURL
}));

describe('certificate asset validation', () => {
    beforeEach(() => {
        Object.values(mocks).forEach((mock) => mock.mockClear());
    });

    it('rejects unsafe storage IDs before auth or upload', async () => {
        const {
            validateCertificateStorageId,
            uploadCertificateAsset,
            uploadSignatureImage
        } = await import('../../js/certificates/assets.js');
        const imageFile = { type: 'image/png', size: 128, name: 'crest.png' };

        expect(validateCertificateStorageId('team_ABC-123', 'team ID')).toBe('team_ABC-123');
        expect(() => validateCertificateStorageId('../team', 'team ID')).toThrow('Invalid team ID format.');
        await expect(uploadCertificateAsset('../team', imageFile)).rejects.toThrow('Invalid team ID format.');
        await expect(uploadSignatureImage('user/bad', imageFile)).rejects.toThrow('Invalid user ID format.');
        expect(mocks.requireImageAuth).not.toHaveBeenCalled();
        expect(mocks.uploadBytes).not.toHaveBeenCalled();
    });
});
