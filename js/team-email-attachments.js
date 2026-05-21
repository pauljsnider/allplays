import {
    auth,
    db,
    storage,
    collection,
    doc,
    addDoc,
    setDoc,
    getDoc,
    Timestamp,
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject
} from './firebase.js?v=13';

export const TEAM_EMAIL_ATTACHMENT_LIMIT_BYTES = 20 * 1024 * 1024;

function safeFileName(name) {
    return String(name || 'attachment').trim().replace(/[^\w.\-]+/g, '_') || 'attachment';
}

function cleanString(value) {
    return String(value || '').trim();
}

export function getTeamEmailAttachmentTotalBytes(attachments = []) {
    return (Array.isArray(attachments) ? attachments : []).reduce((total, attachment) => {
        const size = Number(attachment?.size || attachment?.bytes || 0);
        return total + (Number.isFinite(size) && size > 0 ? size : 0);
    }, 0);
}

export function assertTeamEmailAttachmentLimit(attachments = []) {
    const totalBytes = getTeamEmailAttachmentTotalBytes(attachments);
    if (totalBytes > TEAM_EMAIL_ATTACHMENT_LIMIT_BYTES) {
        throw new Error('Team email attachments must be 20 MB or smaller in total.');
    }
    return totalBytes;
}

export function normalizeTeamEmailAttachments(attachments = []) {
    const normalized = (Array.isArray(attachments) ? attachments : [])
        .map((attachment) => {
            const name = cleanString(attachment?.name || attachment?.fileName);
            const path = cleanString(attachment?.path || attachment?.storagePath);
            const downloadUrl = cleanString(attachment?.downloadUrl || attachment?.url);
            const contentType = cleanString(attachment?.contentType || attachment?.type) || 'application/octet-stream';
            const size = Number(attachment?.size || attachment?.bytes || 0);
            if (!name || !path || !Number.isFinite(size) || size <= 0) return null;
            return {
                name,
                storagePath: path,
                contentType,
                size,
                downloadUrl: downloadUrl || null,
                uploadedBy: cleanString(attachment?.uploadedBy) || null,
                uploadedAt: attachment?.uploadedAt || null
            };
        })
        .filter(Boolean);

    assertTeamEmailAttachmentLimit(normalized);
    return normalized;
}

export async function uploadTeamEmailAttachment(teamId, file, { draftId = 'draft', user = auth.currentUser } = {}) {
    if (!teamId) throw new Error('Missing team for email attachment.');
    if (!file) throw new Error('Missing email attachment file.');
    if (!user?.uid) throw new Error('Sign in to attach files to team emails.');

    assertTeamEmailAttachmentLimit([{ size: file.size }]);

    const ts = Date.now();
    const path = `team-email-attachments/${teamId}/${cleanString(draftId) || 'draft'}/${user.uid}/${ts}_${safeFileName(file.name)}`;
    const storageRef = ref(storage, path);
    const snapshot = await uploadBytes(storageRef, file);
    const downloadUrl = await getDownloadURL(snapshot.ref);

    return {
        name: file.name || 'attachment',
        storagePath: path,
        contentType: file.type || 'application/octet-stream',
        size: Number.isFinite(file.size) ? file.size : 0,
        downloadUrl,
        uploadedBy: user.uid,
        uploadedAt: Timestamp.now()
    };
}

export async function deleteTeamEmailAttachment(attachment) {
    const path = cleanString(attachment?.storagePath || attachment?.path);
    if (!path) return;
    await deleteObject(ref(storage, path));
}

export function buildTeamEmailDeliveryPayload({ draft = {}, teamId, sender = auth.currentUser } = {}) {
    const attachments = normalizeTeamEmailAttachments(draft.attachments || []);
    return {
        teamId,
        draftId: draft.id || null,
        recipients: Array.isArray(draft.recipients) ? draft.recipients : [],
        subject: cleanString(draft.subject),
        body: cleanString(draft.body),
        attachments,
        attachmentTotalBytes: getTeamEmailAttachmentTotalBytes(attachments),
        createdBy: sender?.uid || draft.createdBy || null,
        createdByEmail: sender?.email || draft.createdByEmail || null,
        status: 'queued',
        createdAt: Timestamp.now()
    };
}

export async function saveTeamEmailDraft(teamId, draft = {}, { user = auth.currentUser } = {}) {
    if (!teamId) throw new Error('Missing team for email draft.');
    if (!user?.uid) throw new Error('Sign in to save team email drafts.');

    const now = Timestamp.now();
    const attachments = normalizeTeamEmailAttachments(draft.attachments || []);
    const payload = {
        recipients: Array.isArray(draft.recipients) ? draft.recipients : [],
        subject: cleanString(draft.subject),
        body: cleanString(draft.body),
        attachments,
        attachmentTotalBytes: getTeamEmailAttachmentTotalBytes(attachments),
        updatedAt: now,
        updatedBy: user.uid
    };

    if (draft.id) {
        await setDoc(doc(db, 'teams', teamId, 'emailDrafts', draft.id), payload, { merge: true });
        return draft.id;
    }

    const docRef = await addDoc(collection(db, 'teams', teamId, 'emailDrafts'), {
        ...payload,
        createdAt: now,
        createdBy: user.uid
    });
    return docRef.id;
}

export async function getTeamEmailDraft(teamId, draftId) {
    if (!teamId || !draftId) return null;
    const snap = await getDoc(doc(db, 'teams', teamId, 'emailDrafts', draftId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function queueTeamEmailSend(teamId, draft = {}, { user = auth.currentUser } = {}) {
    if (!teamId) throw new Error('Missing team for email send.');
    if (!user?.uid) throw new Error('Sign in to send team emails.');

    const payload = buildTeamEmailDeliveryPayload({ draft, teamId, sender: user });
    const sendRef = await addDoc(collection(db, 'teams', teamId, 'emailSends'), payload);
    return sendRef.id;
}
