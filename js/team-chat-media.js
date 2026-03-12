export const MAX_CHAT_MEDIA_SIZE = 5 * 1024 * 1024;

function isFiniteSize(value) {
    return Number.isFinite(value) && value >= 0;
}

function toUploadedAt(value) {
    return value ?? null;
}

export function isSafeChatMediaUrl(href) {
    if (!href) return false;
    try {
        const url = new URL(href, 'https://allplays.local');
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

export function getChatAttachmentKind(input) {
    const mimeType = String(input?.mimeType || input?.type || '').toLowerCase();
    if (mimeType === 'image' || mimeType === 'video') return mimeType;
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    return null;
}

function normalizeChatAttachment(input, { strict = true } = {}) {
    const kind = getChatAttachmentKind(input);
    if (!kind) {
        if (strict) throw new Error('Chat attachments must be an image or video.');
        return null;
    }

    const size = isFiniteSize(input?.size) ? input.size : null;
    if (strict && size !== null && size > MAX_CHAT_MEDIA_SIZE) {
        throw new Error('Chat attachments must be 5MB or smaller.');
    }

    const url = input?.url || null;
    if ((url && !isSafeChatMediaUrl(url)) || (!url && !strict)) {
        if (strict && url) throw new Error('Chat attachments must use a safe URL.');
        if (!strict) return null;
    }

    return {
        type: kind,
        url,
        path: input?.path || null,
        thumbnailUrl: input?.thumbnailUrl || null,
        name: input?.name || null,
        mimeType: input?.mimeType || input?.type || null,
        size,
        uploadedAt: toUploadedAt(input?.uploadedAt)
    };
}

export function normalizeChatAttachments(inputs = []) {
    const attachments = (Array.isArray(inputs) ? inputs : [])
        .map((input) => normalizeChatAttachment(input, { strict: true }));

    const firstImage = attachments.find((attachment) => attachment.type === 'image') || null;

    return {
        attachments,
        legacyImage: firstImage ? {
            imageUrl: firstImage.url,
            imagePath: firstImage.path,
            imageName: firstImage.name,
            imageType: firstImage.mimeType,
            imageSize: firstImage.size
        } : {
            imageUrl: null,
            imagePath: null,
            imageName: null,
            imageType: null,
            imageSize: null
        }
    };
}

export function getMessageAttachments(message) {
    const normalized = Array.isArray(message?.attachments) && message.attachments.length > 0
        ? message.attachments
            .map((attachment) => normalizeChatAttachment(attachment, { strict: false }))
            .filter(Boolean)
        : [];

    if (normalized.length > 0) {
        return normalized;
    }

    const legacyImage = normalizeChatAttachment({
        url: message?.imageUrl || null,
        path: message?.imagePath || null,
        name: message?.imageName || null,
        type: message?.imageType || 'image/*',
        size: message?.imageSize ?? null,
        uploadedAt: message?.createdAt || null
    }, { strict: false });

    return legacyImage ? [legacyImage] : [];
}

function getMessageCreatedAt(message) {
    const createdAt = message?.createdAt;
    if (createdAt?.toDate) return createdAt.toDate();
    const parsed = createdAt ? new Date(createdAt) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

export function collectThreadMedia(messages = []) {
    return (Array.isArray(messages) ? messages : [])
        .filter((message) => message && message.deleted !== true)
        .flatMap((message) => {
            const createdAt = getMessageCreatedAt(message);
            return getMessageAttachments(message)
                .filter((attachment) => isSafeChatMediaUrl(attachment.url))
                .map((attachment, index) => ({
                    ...attachment,
                    messageId: message.id || null,
                    senderName: message.senderName || message.senderEmail || 'Unknown',
                    createdAt,
                    attachmentIndex: index
                }));
        })
        .sort((a, b) => {
            const aTime = a.createdAt ? a.createdAt.getTime() : 0;
            const bTime = b.createdAt ? b.createdAt.getTime() : 0;
            return bTime - aTime || a.attachmentIndex - b.attachmentIndex;
        });
}
