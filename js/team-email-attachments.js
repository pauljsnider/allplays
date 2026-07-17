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
} from './firebase.js?v=20';

export const TEAM_EMAIL_ATTACHMENT_LIMIT_BYTES = 20 * 1024 * 1024;

function safeFileName(name) {
    return String(name || 'attachment').trim().replace(/[^\w.\-]+/g, '_') || 'attachment';
}

function cleanString(value) {
    return String(value || '').trim();
}

function normalizeEmail(value) {
    return cleanString(value).toLowerCase();
}

function getAttachmentTeamIdFromPath(path) {
    const parts = cleanString(path).split('/');
    return parts[0] === 'team-email-attachments' ? cleanString(parts[1]) : '';
}

function isTeamEmailAttachmentPathForTeam(teamId, path) {
    const cleanTeamId = cleanString(teamId);
    const parts = cleanString(path).split('/');
    return parts.length >= 5 &&
        parts[0] === 'team-email-attachments' &&
        parts[1] === cleanTeamId &&
        parts.slice(2).every(Boolean);
}

async function assertTeamEmailManagerAccess(teamId, user = auth.currentUser) {
    const cleanTeamId = cleanString(teamId);
    if (!cleanTeamId) throw new Error('Missing team for team email action.');
    if (!user?.uid) throw new Error('Sign in to manage team email.');

    const teamSnap = await getDoc(doc(db, 'teams', cleanTeamId));
    if (!teamSnap.exists()) throw new Error('Team not found.');

    const team = teamSnap.data() || {};
    const userEmail = normalizeEmail(user.email);
    const adminEmails = Array.isArray(team.adminEmails)
        ? team.adminEmails.map(normalizeEmail)
        : [];
    let isGlobalAdmin = user.isAdmin === true;
    if (!isGlobalAdmin) {
        try {
            const userSnap = await getDoc(doc(db, 'users', user.uid));
            isGlobalAdmin = userSnap.exists() && userSnap.data()?.isAdmin === true;
        } catch (_) {
            isGlobalAdmin = false;
        }
    }

    if (team.ownerId !== user.uid && !adminEmails.includes(userEmail) && !isGlobalAdmin) {
        throw new Error('Only team coaches and admins can manage team email.');
    }
    return { teamId: cleanTeamId, team };
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
    if (!file) throw new Error('Missing email attachment file.');
    const { teamId: cleanTeamId } = await assertTeamEmailManagerAccess(teamId, user);

    assertTeamEmailAttachmentLimit([{ size: file.size }]);

    const ts = Date.now();
    const path = `team-email-attachments/${cleanTeamId}/${cleanString(draftId) || 'draft'}/${user.uid}/${ts}_${safeFileName(file.name)}`;
    try {
        const storageRef = ref(storage, path);
        const snapshot = await uploadBytes(storageRef, file);
        const downloadUrl = await getDownloadURL(snapshot.ref);

        return {
            name: file.name || 'attachment',
            storagePath: path,
            teamId: cleanTeamId,
            contentType: file.type || 'application/octet-stream',
            size: Number.isFinite(file.size) ? file.size : 0,
            downloadUrl,
            uploadedBy: user.uid,
            uploadedAt: Timestamp.now()
        };
    } catch (error) {
        console.error('Error uploading team email attachment:', error);
        throw error;
    }
}

export async function deleteTeamEmailAttachment(attachment, { user = auth.currentUser } = {}) {
    const path = cleanString(attachment?.storagePath || attachment?.path);
    if (!path) return false;
    const teamId = cleanString(attachment?.teamId) || getAttachmentTeamIdFromPath(path);
    await assertTeamEmailManagerAccess(teamId, user);
    if (!isTeamEmailAttachmentPathForTeam(teamId, path)) {
        throw new Error('Team email attachment path does not belong to this team.');
    }
    try {
        await deleteObject(ref(storage, path));
        return true;
    } catch (error) {
        console.error('Error deleting team email attachment:', error);
        throw error;
    }
}

export async function saveTeamEmailDraft(teamId, draft = {}, { user = auth.currentUser } = {}) {
    const { teamId: cleanTeamId } = await assertTeamEmailManagerAccess(teamId, user);

    const now = Timestamp.now();
    const attachments = normalizeTeamEmailAttachments(draft.attachments || []);
    const recipients = Array.isArray(draft.recipients) ? draft.recipients : [];
    const recipientEmails = recipients
        .map((recipient) => normalizeEmail(recipient?.email))
        .filter(Boolean);
    const payload = {
        recipients,
        recipientEmails,
        subject: cleanString(draft.subject),
        body: cleanString(draft.body),
        attachments,
        attachmentTotalBytes: getTeamEmailAttachmentTotalBytes(attachments),
        authorId: draft.authorId || user.uid,
        authorEmail: draft.authorEmail || user.email || null,
        authorName: draft.authorName || user.displayName || null,
        status: 'draft',
        updatedAt: now
    };

    if (draft.id) {
        await setDoc(doc(db, 'teams', cleanTeamId, 'emailDrafts', draft.id), payload, { merge: true });
        return draft.id;
    }

    const docRef = await addDoc(collection(db, 'teams', cleanTeamId, 'emailDrafts'), {
        ...payload,
        createdAt: now
    });
    return docRef.id;
}

export async function getTeamEmailDraft(teamId, draftId) {
    if (!teamId || !draftId) return null;
    const { teamId: cleanTeamId } = await assertTeamEmailManagerAccess(teamId);
    const snap = await getDoc(doc(db, 'teams', cleanTeamId, 'emailDrafts', draftId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
