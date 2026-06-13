import { postLiveChatMessage, subscribeLiveChat } from '../../../../js/db.js';
import { isViewerChatEnabled } from '../../../../js/live-game-chat.js';
import type { AuthUser } from './types';

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
    if (!compactString(user?.uid)) {
        throw new Error('Sign in before chatting.');
    }

    const senderName = compactString(user?.displayName) || compactString(user?.email);

    if (!senderName) {
        throw new Error('Add a display name before sending.');
    }

    return {
        text,
        senderId: user?.uid || null,
        senderName,
        senderPhotoUrl: compactString(user?.photoUrl) || null,
        isAnonymous: false
    };
}

export function subscribeToLiveGameChat(
    teamId: string,
    gameId: string,
    callback: (messages: LiveGameChatMessage[]) => void,
    onError?: (error: unknown) => void
) {
    return subscribeLiveChat(teamId, gameId, { limit: 100 }, callback, onError);
}

export async function sendLiveGameChatMessage(
    teamId: string,
    gameId: string,
    input: {
        text: string;
        user?: AuthUser | null;
        anonymousDisplayName?: string | null;
    }
) {
    const payload = buildLiveGameChatPayload(input);
    await postLiveChatMessage(teamId, gameId, payload);
    return payload;
}
