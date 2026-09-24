import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    uploadBytes: vi.fn(),
    getDownloadURL: vi.fn(),
    deleteObject: vi.fn(async () => undefined),
    addDoc: vi.fn(),
    collection: vi.fn(),
    ref: vi.fn()
}));

vi.mock('../../js/firebase.js?v=33', () => ({
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

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('uses secure random bytes when randomUUID is unavailable and fails closed without secure randomness', async () => {
        const { buildCertificateUploadToken } = await import('../../js/certificates/assets.js');
        const getRandomValues = vi.fn((bytes) => {
            bytes.set(Array.from({ length: 16 }, (_value, index) => index));
            return bytes;
        });
        vi.stubGlobal('crypto', { getRandomValues });

        expect(buildCertificateUploadToken()).toBe('000102030405060708090a0b0c0d0e0f');
        expect(getRandomValues).toHaveBeenCalledOnce();

        vi.stubGlobal('crypto', {});
        expect(() => buildCertificateUploadToken()).toThrow('Secure randomness is required');
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
        await expect(uploadSignatureImage('team/bad', imageFile)).rejects.toThrow('Invalid team ID format.');
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
        expect(asset.path).toBe(asset.storagePath);

        mocks.ref.mockClear();
        mocks.uploadBytes.mockClear();
        mocks.getDownloadURL.mockClear();
        mocks.ref.mockReturnValue({ fullPath: 'certificate-signatures/teams/team-1/random.png' });
        mocks.uploadBytes.mockResolvedValue({ ref: { fullPath: 'certificate-signatures/teams/team-1/random.png' } });
        mocks.getDownloadURL.mockResolvedValue('https://example.com/signature.png');

        const signature = await uploadSignatureImage('team-1', imageFile);

        expect(mocks.ref).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'primary-storage' }),
            expect.stringMatching(/^certificate-signatures\/teams\/team-1\/[a-zA-Z0-9_]+\.png$/)
        );
        expect(mocks.ref.mock.calls[0][1]).not.toContain('private');
        expect(signature.storage).toBe('primary');
        expect(signature.path).toBe(signature.storagePath);
        expect(signature.storagePath).toMatch(/^certificate-signatures\/teams\/team-1\/[a-zA-Z0-9_]+\.png$/);
    });

    it('rejects certificate uploads for a mismatched signed-in account before Storage', async () => {
        const { uploadCertificateAsset } = await import('../../js/certificates/assets.js');
        const imageFile = { type: 'image/png', size: 128, name: 'crest.png' };

        await expect(uploadCertificateAsset('team-1', imageFile, 'background', 'other-user'))
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

    it('deletes only a signature at the exact requested team cleanup path', async () => {
        const storageRef = { fullPath: 'certificate-signatures/teams/team-1/random.png' };
        mocks.ref.mockReturnValue(storageRef);
        const { deleteSignatureImage } = await import('../../js/certificates/assets.js');

        await deleteSignatureImage('team-1', storageRef.fullPath);

        expect(mocks.ref).toHaveBeenCalledWith(expect.objectContaining({ name: 'primary-storage' }), storageRef.fullPath);
        expect(mocks.deleteObject).toHaveBeenCalledWith(storageRef);
        await expect(deleteSignatureImage('team-1', 'certificate-signatures/teams/team-2/random.png'))
            .rejects.toThrow('Invalid certificate signature cleanup path.');
        await expect(deleteSignatureImage('team-2', storageRef.fullPath))
            .rejects.toThrow('Invalid certificate signature cleanup path.');
    });

    it('attempts scoped cleanup when a certificate Storage upload rejects ambiguously', async () => {
        const storageRef = { fullPath: 'certificate-signatures/teams/team-1/random.png' };
        mocks.ref.mockReturnValue(storageRef);
        mocks.uploadBytes.mockRejectedValue(new Error('deadline-exceeded'));
        const { uploadSignatureImage } = await import('../../js/certificates/assets.js');

        await expect(uploadSignatureImage('team-1', {
            type: 'image/png',
            size: 128,
            name: 'signature.png'
        })).rejects.toThrow('deadline-exceeded');

        expect(mocks.deleteObject).toHaveBeenCalledWith(storageRef);
    });
});
