import {
    db,
    auth,
    storage,
    collection,
    addDoc,
    Timestamp,
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject
} from '../firebase.js?v=26';
import { createSecureUploadToken } from '../secure-upload-token.js?v=1';

const MAX_CERTIFICATE_ASSET_BYTES = 5 * 1024 * 1024;
const ALLOWED_CERTIFICATE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

export function sanitizeCertificateFilename(fileName = 'asset') {
    const safe = String(fileName || 'asset').replace(/[^\w.\-]+/g, '_').replace(/^_+|_+$/g, '');
    return safe || 'asset';
}

export function validateCertificateStorageId(value, label = 'ID') {
    if (!value) {
        throw new Error(`Missing ${label}.`);
    }

    const normalized = String(value);
    if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
        throw new Error(`Invalid ${label} format.`);
    }
    return normalized;
}

export function validateCertificateImageFile(file) {
    if (!file) {
        throw new Error('Choose an image file to upload.');
    }

    const type = String(file.type || '').toLowerCase();
    if (!ALLOWED_CERTIFICATE_IMAGE_TYPES.has(type)) {
        throw new Error('Certificate images must be PNG, JPG, or WebP.');
    }

    const size = Number(file.size || 0);
    if (!Number.isFinite(size) || size <= 0) {
        throw new Error('Choose a valid certificate image.');
    }

    if (size > MAX_CERTIFICATE_ASSET_BYTES) {
        throw new Error('Certificate images must be 5 MB or smaller.');
    }
}

function getCertificateImageExtension(file) {
    const type = String(file?.type || '').toLowerCase();
    if (type === 'image/png') return '.png';
    if (type === 'image/webp') return '.webp';
    return '.jpg';
}

export function buildCertificateUploadToken() {
    try {
        return createSecureUploadToken();
    } catch {
        throw new Error('Secure randomness is required to upload certificate images.');
    }
}

export function buildCertificateAssetStoragePath(teamId, file) {
    const safeTeamId = validateCertificateStorageId(teamId, 'team ID');
    return `certificate-assets/teams/${safeTeamId}/${buildCertificateUploadToken()}${getCertificateImageExtension(file)}`;
}

export function buildCertificateSignatureStoragePath(teamId, file) {
    const safeTeamId = validateCertificateStorageId(teamId, 'team ID');
    return `certificate-signatures/teams/${safeTeamId}/${buildCertificateUploadToken()}${getCertificateImageExtension(file)}`;
}

async function getCertificateAssetUrlOrDelete(storageRef) {
    try {
        return await getDownloadURL(storageRef);
    } catch (error) {
        await deleteObject(storageRef).catch(() => undefined);
        throw error;
    }
}

export async function uploadCertificateAsset(teamId, file, kind = 'generic', uploaderId = null) {
    if (!teamId) throw new Error('Missing team for certificate asset upload.');
    const safeTeamId = validateCertificateStorageId(teamId, 'team ID');
    validateCertificateImageFile(file);
    const signedInUserId = String(auth.currentUser?.uid || '').trim();
    if (!signedInUserId) throw new Error('A signed-in team admin is required to upload certificate images.');
    if (uploaderId && String(uploaderId).trim() !== signedInUserId) {
        throw new Error('The signed-in account does not match this certificate upload.');
    }

    const normalizedKind = ['foreground', 'background', 'watermark', 'generic'].includes(kind) ? kind : 'generic';
    const safeName = sanitizeCertificateFilename(file.name);
    const storagePath = buildCertificateAssetStoragePath(safeTeamId, file);
    const storageRef = ref(storage, storagePath);
    let snapshot;
    let url;
    try {
        snapshot = await uploadBytes(storageRef, file, { contentType: file.type });
        url = await getCertificateAssetUrlOrDelete(snapshot.ref);
    } catch (error) {
        await deleteObject(storageRef).catch(() => undefined);
        throw error;
    }

    const assetDoc = {
        url,
        path: storagePath,
        storagePath,
        originalFilename: file.name || safeName,
        contentType: file.type || null,
        sizeBytes: Number.isFinite(file.size) ? file.size : null,
        uploaderId: uploaderId || null,
        uploadedAt: Timestamp.now(),
        kind: normalizedKind,
        storage: 'primary'
    };
    try {
        const docRef = await addDoc(collection(db, 'teams', safeTeamId, 'certificateAssets'), assetDoc);
        return { id: docRef.id, ...assetDoc };
    } catch (error) {
        await deleteObject(snapshot.ref).catch(() => undefined);
        throw error;
    }
}

export async function uploadSignatureImage(teamId, file) {
    if (!teamId) throw new Error('A team is required to upload a signature.');
    const safeTeamId = validateCertificateStorageId(teamId, 'team ID');
    validateCertificateImageFile(file);
    const signedInUserId = String(auth.currentUser?.uid || '').trim();
    if (!signedInUserId) throw new Error('A signed-in team admin is required to upload a signature.');

    const safeName = sanitizeCertificateFilename(file.name);
    const storagePath = buildCertificateSignatureStoragePath(safeTeamId, file);
    const storageRef = ref(storage, storagePath);
    try {
        const snapshot = await uploadBytes(storageRef, file, { contentType: file.type });
        return {
            url: await getCertificateAssetUrlOrDelete(snapshot.ref),
            path: storagePath,
            storagePath,
            originalFilename: file.name || safeName,
            contentType: file.type || null,
            sizeBytes: Number.isFinite(file.size) ? file.size : null,
            storage: 'primary'
        };
    } catch (error) {
        await deleteObject(storageRef).catch(() => undefined);
        throw error;
    }
}

export async function deleteSignatureImage(teamId, storagePath) {
    const safeTeamId = validateCertificateStorageId(teamId, 'team ID');
    const signedInUserId = String(auth.currentUser?.uid || '').trim();
    if (!signedInUserId) throw new Error('A signed-in team admin is required to delete a signature.');
    const normalizedPath = String(storagePath || '').trim();
    const prefix = `certificate-signatures/teams/${safeTeamId}/`;
    const objectName = normalizedPath.slice(prefix.length);
    if (!normalizedPath.startsWith(prefix) || !objectName || objectName.includes('/')) {
        throw new Error('Invalid certificate signature cleanup path.');
    }
    await deleteObject(ref(storage, normalizedPath));
}
