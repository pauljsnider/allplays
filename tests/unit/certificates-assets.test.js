import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    uploadBytes: vi.fn(),
    getDownloadURL: vi.fn(),
    deleteObject: vi.fn(async () => undefined),
    addDoc: vi.fn(),
    collection: vi.fn(),
    ref: vi.fn()
}));

vi.mock('../../js/firebase.js?v=23', () => ({
    db: {},
    auth: { currentUser: { uid: 'user-1' } },
    storage: { name: 'primary-storage' },
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
        expect(mocks.uploadBytes).not.toHaveBeenCalled();
    });

    it('rejects empty files before any durable upload', async () => {
        const { uploadCertificateAsset } = await import('../../js/certificates/assets.js');

        await expect(uploadCertificateAsset('team-1', {
            type: 'image/png',
            size: 0,
            name: 'empty.png'
        }, 'background', 'user-1')).rejects.toThrow('Choose a valid certificate image.');

        expect(mocks.uploadBytes).not.toHaveBeenCalled();
        expect(mocks.addDoc).not.toHaveBeenCalled();
    });

    it('uses signed-in primary Storage paths without uploader ids or original filenames', async () => {
        const storageRef = { fullPath: 'certificate-assets/teams/team-1/random.png' };
        mocks.ref.mockReturnValue(storageRef);
        mocks.uploadBytes.mockResolvedValue({ ref: storageRef });
        mocks.getDownloadURL.mockResolvedValue('https://example.com/certificate.png');
        mocks.collection.mockReturnValue({ path: 'teams/team-1/certificateAssets' });
        mocks.addDoc.mockResolvedValue({ id: 'asset-1' });
        const { uploadCertificateAsset, uploadSignatureImage } = await import('../../js/certificates/assets.js');
        const imageFile = { type: 'image/png', size: 128, name: 'private family crest.png' };

        const asset = await uploadCertificateAsset('team-1', imageFile, 'background', 'user-1');

        expect(mocks.ref).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ name: 'primary-storage' }),
            expect.stringMatching(/^certificate-assets\/teams\/team-1\/[a-zA-Z0-9_]+\.png$/)
        );
        expect(mocks.ref.mock.calls[0][1]).not.toContain('user-1');
        expect(mocks.ref.mock.calls[0][1]).not.toContain('private');
        expect(mocks.uploadBytes).toHaveBeenNthCalledWith(1, storageRef, imageFile, { contentType: 'image/png' });
        expect(asset.storage).toBe('primary');

        mocks.ref.mockClear();
        mocks.uploadBytes.mockClear();
        mocks.getDownloadURL.mockClear();
        mocks.ref.mockReturnValue({ fullPath: 'certificate-signatures/users/user-1/random.png' });
        mocks.uploadBytes.mockResolvedValue({ ref: { fullPath: 'certificate-signatures/users/user-1/random.png' } });
        mocks.getDownloadURL.mockResolvedValue('https://example.com/signature.png');

        const signature = await uploadSignatureImage('user-1', imageFile);

        expect(mocks.ref).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'primary-storage' }),
            expect.stringMatching(/^certificate-signatures\/users\/user-1\/[a-zA-Z0-9_]+\.png$/)
        );
        expect(mocks.ref.mock.calls[0][1]).not.toContain('private');
        expect(signature.storage).toBe('primary');
    });

    it('rejects certificate uploads for a mismatched signed-in account before Storage', async () => {
        const { uploadCertificateAsset, uploadSignatureImage } = await import('../../js/certificates/assets.js');
        const imageFile = { type: 'image/png', size: 128, name: 'crest.png' };

        await expect(uploadCertificateAsset('team-1', imageFile, 'background', 'other-user'))
            .rejects.toThrow('signed-in account does not match');
        await expect(uploadSignatureImage('other-user', imageFile))
            .rejects.toThrow('signed-in account does not match');
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
