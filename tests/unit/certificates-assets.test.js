import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    requireImageAuth: vi.fn(),
    uploadBytes: vi.fn(),
    getDownloadURL: vi.fn(),
    deleteObject: vi.fn(async () => undefined),
    addDoc: vi.fn(),
    collection: vi.fn(),
    ref: vi.fn()
}));

vi.mock('../../js/firebase-images.js?v=11', () => ({
    imageStorage: {},
    requireImageAuth: mocks.requireImageAuth
}));

vi.mock('../../js/firebase.js?v=22', () => ({
    db: {},
    collection: mocks.collection,
    addDoc: mocks.addDoc,
    Timestamp: { now: () => ({ seconds: 1 }) },
    ref: mocks.ref,
    uploadBytes: mocks.uploadBytes,
    getDownloadURL: mocks.getDownloadURL,
    deleteObject: mocks.deleteObject
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

    it('deletes a completed upload when its download URL cannot be resolved', async () => {
        const storageRef = { fullPath: 'team-photos/certificate.png' };
        mocks.ref.mockReturnValue(storageRef);
        mocks.uploadBytes.mockResolvedValue({ ref: storageRef });
        mocks.getDownloadURL.mockRejectedValue(new Error('url lookup failed'));
        const { uploadCertificateAsset } = await import('../../js/certificates/assets.js');

        await expect(uploadCertificateAsset('team-1', {
            type: 'image/png',
            size: 128,
            name: 'crest.png'
        })).rejects.toThrow('url lookup failed');

        expect(mocks.deleteObject).toHaveBeenCalledWith(storageRef);
        expect(mocks.addDoc).not.toHaveBeenCalled();
    });

    it('deletes a completed upload when its Firestore asset record cannot be saved', async () => {
        const storageRef = { fullPath: 'team-photos/certificate.png' };
        const firestoreError = new Error('asset record save failed');
        mocks.ref.mockReturnValue(storageRef);
        mocks.uploadBytes.mockResolvedValue({ ref: storageRef });
        mocks.getDownloadURL.mockResolvedValue('https://example.com/certificate.png');
        mocks.collection.mockReturnValue({ path: 'teams/team-1/certificateAssets' });
        mocks.addDoc.mockRejectedValue(firestoreError);
        const { uploadCertificateAsset } = await import('../../js/certificates/assets.js');

        await expect(uploadCertificateAsset('team-1', {
            type: 'image/png',
            size: 128,
            name: 'crest.png'
        })).rejects.toThrow('asset record save failed');

        expect(mocks.deleteObject).toHaveBeenCalledWith(storageRef);
    });
});
