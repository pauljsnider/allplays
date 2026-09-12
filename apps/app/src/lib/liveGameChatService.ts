import { isViewerChatEnabled, postLiveChatMessage, resolveSafeProfilePhotoWriteUrl, subscribeLiveChat } from './adapters/legacyLiveGameChat';
import {
    createDiamondLiveEngagementRequestId,
    moderateDiamondLiveChat,
    postDiamondLiveChat,
    subscribeDiamondLiveChat,
} from './diamondLiveEngagementService';
import type { AuthUser } from './types';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pendingDiamondChatRequests = new Map<string, string>();
const pendingDiamondModerationRequests = new Map<string, string>();

export type DiamondLiveChatContext = {
    trackingEngine: 'diamond-v2';
    instanceId: string;
};

export type LiveGameChatMessage = {
    id: string;
    text?: string | null;
    senderId?: string | null;
    senderName?: string | null;
    senderPhotoUrl?: string | null;
    isAnonymous?: boolean;
    createdAt?: unknown;
};

export type LiveGameChatEligibilityGame = {
    date?: Date | string | { toDate: () => Date } | null;
    liveStatus?: string | null;
    status?: string | null;
};

export type LiveGameChatPayload = {
    text: string;
    senderId: string | null;
    senderName: string;
    senderPhotoUrl: string | null;
    isAnonymous: boolean;
};

function compactString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function canUseLiveGameChat(game: LiveGameChatEligibilityGame | null | undefined, options?: { isReplay?: boolean; now?: Date }) {
    return isViewerChatEnabled({
        ...game,
        liveStatus: game?.liveStatus || (game?.status === 'live' ? 'live' : null)
    }, options);
}

export function getLiveGameChatNotice(game: LiveGameChatEligibilityGame | null | undefined, options?: { isReplay?: boolean; now?: Date }) {
    if (options?.isReplay) {
        return 'Live chat is closed during replay.';
    }
    if (canUseLiveGameChat(game, options)) {
        return null;
    }
    return 'Live chat opens on game day and closes after the live window ends.';
}

export function buildLiveGameChatPayload(input: {
    text: string;
    user?: AuthUser | null;
    anonymousDisplayName?: string | null;
}): LiveGameChatPayload {
    const text = compactString(input.text);
    if (!text) {
        throw new Error('Enter a message before sending.');
    }

    const user = input.user || null;
    const anonymousDisplayName = compactString(input.anonymousDisplayName);
    const senderName = compactString(user?.displayName) || compactString(user?.email) || anonymousDisplayName;

    if (!senderName) {
        throw new Error('Add a display name before sending.');
    }

    return {
        text,
        senderId: user?.uid || null,
        senderName,
        senderPhotoUrl: resolveSafeProfilePhotoWriteUrl(user?.photoUrl) || null,
        isAnonymous: !user
    };
}

export function subscribeToLiveGameChat(
    teamId: string,
    gameId: string,
    callback: (messages: LiveGameChatMessage[]) => void,
    onError?: (error: unknown) => void,
    options?: { diamond?: DiamondLiveChatContext | null }
) {
    if (options?.diamond) {
        return subscribeDiamondLiveChat<LiveGameChatMessage>(
            teamId,
            gameId,
            options.diamond.instanceId,
            callback,
            onError
        );
    }
    return subscribeLiveChat(teamId, gameId, { limit: 100 }, callback, onError);
}

export async function sendLiveGameChatMessage(
    teamId: string,
    gameId: string,
    input: {
        text: string;
        user?: AuthUser | null;
        anonymousDisplayName?: string | null;
        diamond?: DiamondLiveChatContext | null;
    }
) {
    const payload = buildLiveGameChatPayload(input);
    if (input.diamond) {
        if (!input.user?.uid) {
            throw new Error('Sign in before posting to a Diamond game.');
        }
        const instanceId = compactString(input.diamond.instanceId).toLowerCase();
        if (
            input.diamond.trackingEngine !== 'diamond-v2'
            || !UUID_V4_PATTERN.test(instanceId)
        ) {
            throw new Error('The Diamond game generation is unavailable.');
        }
        const pendingKey = JSON.stringify([teamId, gameId, instanceId, payload.text]);
        const requestId = pendingDiamondChatRequests.get(pendingKey)
            || createDiamondLiveEngagementRequestId();
        pendingDiamondChatRequests.set(pendingKey, requestId);
        await postDiamondLiveChat({ teamId, gameId, instanceId, requestId }, payload.text);
        if (pendingDiamondChatRequests.get(pendingKey) === requestId) {
            pendingDiamondChatRequests.delete(pendingKey);
        }
        return payload;
    }
    await postLiveChatMessage(teamId, gameId, payload);
    return payload;
}

export async function moderateLiveGameChatMessage(
    teamId: string,
    gameId: string,
    messageId: string,
    input: {
        user?: AuthUser | null;
        diamond: DiamondLiveChatContext;
    }
) {
    if (!input.user?.uid) {
        throw new Error('Sign in before moderating a Diamond game.');
    }
    const instanceId = compactString(input.diamond?.instanceId).toLowerCase();
    if (
        input.diamond?.trackingEngine !== 'diamond-v2'
        || !UUID_V4_PATTERN.test(instanceId)
    ) {
        throw new Error('The Diamond game generation is unavailable.');
    }
    const normalizedMessageId = compactString(messageId);
    if (!/^diamond-chat-[a-f0-9]{64}$/.test(normalizedMessageId)) {
        throw new Error('Live chat message identity is invalid.');
    }
    const pendingKey = JSON.stringify([teamId, gameId, instanceId, normalizedMessageId]);
    const requestId = pendingDiamondModerationRequests.get(pendingKey)
        || createDiamondLiveEngagementRequestId();
    pendingDiamondModerationRequests.set(pendingKey, requestId);
    await moderateDiamondLiveChat(
        { teamId, gameId, instanceId, requestId },
        normalizedMessageId
    );
    if (pendingDiamondModerationRequests.get(pendingKey) === requestId) {
        pendingDiamondModerationRequests.delete(pendingKey);
    }
}
