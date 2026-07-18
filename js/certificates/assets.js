import { imageStorage, requireImageAuth } from '../firebase-images.js?v=10';
import {
    db,
    collection,
    addDoc,
    Timestamp,
    ref,
    uploadBytes,
    getDownloadURL
} from '../firebase.js?v=22';

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

    if (Number(file.size || 0) > MAX_CERTIFICATE_ASSET_BYTES) {
        throw new Error('Certificate images must be 5 MB or smaller.');
    }
}

export async function uploadCertificateAsset(teamId, file, kind = 'generic', uploaderId = null) {
    if (!teamId) throw new Error('Missing team for certificate asset upload.');
    const safeTeamId = validateCertificateStorageId(teamId, 'team ID');
    validateCertificateImageFile(file);
    await requireImageAuth();

    const normalizedKind = ['foreground', 'background', 'watermark', 'generic'].includes(kind) ? kind : 'generic';
    const safeName = sanitizeCertificateFilename(file.name);
    const storagePath = `team-photos/${Date.now()}_certificate_${safeTeamId}_${normalizedKind}_${safeName}`;
    const storageRef = ref(imageStorage, storagePath);
    const snapshot = await uploadBytes(storageRef, file);
    const url = await getDownloadURL(snapshot.ref);

    const assetDoc = {
        url,
        storagePath,
        originalFilename: file.name || safeName,
        contentType: file.type || null,
        sizeBytes: Number.isFinite(file.size) ? file.size : null,
        uploaderId: uploaderId || null,
        uploadedAt: Timestamp.now(),
        kind: normalizedKind
    };
    try {
        const docRef = await addDoc(collection(db, 'teams', safeTeamId, 'certificateAssets'), assetDoc);
        return { id: docRef.id, ...assetDoc };
    } catch (error) {
        console.warn('[certificates] asset uploaded but Firestore asset save failed:', error);
        return {
            id: null,
            ...assetDoc,
            source: 'storage-upload',
            firestoreSaveFailed: true,
            firestoreSaveError: error?.message || 'Unable to save asset metadata.'
        };
    }
}

export async function uploadSignatureImage(userId, file) {
    if (!userId) throw new Error('A signed-in user is required to upload a signature.');
    const safeUserId = validateCertificateStorageId(userId, 'user ID');
    validateCertificateImageFile(file);
    await requireImageAuth();

    const safeName = sanitizeCertificateFilename(file.name);
    const storagePath = `user-photos/${Date.now()}_certificate-signature_${safeUserId}_${safeName}`;
    const storageRef = ref(imageStorage, storagePath);
    const snapshot = await uploadBytes(storageRef, file);
    return {
        url: await getDownloadURL(snapshot.ref),
        storagePath,
        originalFilename: file.name || safeName,
        contentType: file.type || null,
        sizeBytes: Number.isFinite(file.size) ? file.size : null
    };
}
