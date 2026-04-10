export const MAX_CHAT_MEDIA_SIZE = 5 * 1024 * 1024;
const CHAT_MEDIA_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
});

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

function getChatMediaCreatedAt(entry) {
    const createdAt = entry?.createdAt;
    if (createdAt instanceof Date && !Number.isNaN(createdAt.getTime())) return createdAt;
    if (createdAt?.toDate) return createdAt.toDate();
    const parsed = createdAt ? new Date(createdAt) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function getChatMediaExtension(entry) {
    const rawName = String(entry?.name || '').trim();
    const nameMatch = rawName.match(/\.([a-z0-9]{2,5})$/i);
    if (nameMatch) return nameMatch[1].toLowerCase();

    const mimeType = String(entry?.mimeType || '').toLowerCase();
    if (mimeType.includes('/')) {
        const [, subtype] = mimeType.split('/');
        if (subtype) {
            return subtype.split('+')[0].toLowerCase();
        }
    }

    return entry?.type === 'video' ? 'mp4' : 'jpg';
}

function sanitizeChatMediaStem(value) {
    return String(value || '')
        .trim()
        .replace(/\.[a-z0-9]{2,5}$/i, '')
        .replace(/[^a-z0-9]+/gi, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80);
}

export function getChatMediaDownloadName(entry = {}) {
    const extension = getChatMediaExtension(entry);
    const rawName = String(entry?.name || '').trim();
    const sanitizedStem = sanitizeChatMediaStem(rawName);
    if (sanitizedStem) {
        return `${sanitizedStem}.${extension}`;
    }

    const createdAt = getChatMediaCreatedAt(entry);
    const dateLabel = createdAt
        ? createdAt.toISOString().slice(0, 10)
        : 'media';
    const kindLabel = entry?.type === 'video' ? 'video' : 'photo';
    return `team-chat-${kindLabel}-${dateLabel}.${extension}`;
}

export function buildChatMediaShareDetails(entry = {}) {
    const kindLabel = entry?.type === 'video' ? 'video' : 'photo';
    const createdAt = getChatMediaCreatedAt(entry);
    const dateLabel = createdAt ? CHAT_MEDIA_DATE_FORMATTER.format(createdAt) : null;
    const senderName = String(entry?.senderName || '').trim();

    return {
        title: `Team chat ${kindLabel}`,
        text: senderName && dateLabel
            ? `Shared by ${senderName} on ${dateLabel}`
            : senderName
                ? `Shared by ${senderName}`
                : dateLabel
                    ? `Shared on ${dateLabel}`
                    : 'Shared from team chat',
        url: isSafeChatMediaUrl(entry?.url) ? entry.url : ''
    };
}

export function getChatMediaActionState(entry = {}, {
    canNativeShare = false,
    canCopyLink = false
} = {}) {
    const hasSafeUrl = isSafeChatMediaUrl(entry?.url);

    return {
        canShare: hasSafeUrl && Boolean(canNativeShare),
        canDownload: hasSafeUrl,
        canCopyLink: hasSafeUrl && Boolean(canCopyLink)
    };
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
