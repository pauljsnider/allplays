export const DEFAULT_TEAM_CONVERSATION_ID = 'team';
const STAFF_ROLE_CONVERSATION_ID = 'group_role%3Astaff';

const CONVERSATION_TYPES = new Set(['team', 'group', 'direct']);

export function normalizeConversationType(type) {
    return CONVERSATION_TYPES.has(type) ? type : 'group';
}

export function normalizeConversationParticipantIds(participantIds = []) {
    return Array.from(new Set((Array.isArray(participantIds) ? participantIds : [])
        .map((id) => {
            const normalizedId = String(id || '').trim();
            return normalizedId.toLowerCase().startsWith('email:')
                ? `email:${normalizedId.slice(6).trim().toLowerCase()}`
                : normalizedId;
        })
        .filter(Boolean)))
        .sort();
}

function normalizeConversationParticipantRoles(participantRoles = []) {
    return Array.from(new Set((Array.isArray(participantRoles) ? participantRoles : [])
        .map((role) => String(role || '').trim().toLowerCase())
        .filter(Boolean)))
        .sort();
}

export function buildConversationId(type, participantIds = [], participantRoles = []) {
    const normalizedType = normalizeConversationType(type);
    if (normalizedType === 'team') return DEFAULT_TEAM_CONVERSATION_ID;

    const roles = normalizeConversationParticipantRoles(participantRoles);
    if (normalizedType === 'group' && roles.length === 1 && roles[0] === 'staff') {
        return STAFF_ROLE_CONVERSATION_ID;
    }

    const participants = normalizeConversationParticipantIds(participantIds);
    const prefix = normalizedType === 'direct' && participants.length === 2 ? 'direct' : 'group';
    const suffix = participants.map((id) => encodeURIComponent(id)).join('__');
    return suffix ? `${prefix}_${suffix}` : `${prefix}_empty`;
}

export function buildDefaultTeamConversation(team = {}) {
    return {
        id: DEFAULT_TEAM_CONVERSATION_ID,
        type: 'team',
        name: team?.name ? `${team.name} Team Chat` : 'Team Chat',
        participantIds: [],
        participantRoles: ['team'],
        mutedBy: [],
        isDefault: true,
        isLegacy: true
    };
}

export function isDefaultTeamConversation(conversationId) {
    return !conversationId || conversationId === DEFAULT_TEAM_CONVERSATION_ID;
}

export function isUserInConversation(conversation, user = {}, { canModerate = false } = {}) {
    if (!conversation) return false;
    if (conversation.id === DEFAULT_TEAM_CONVERSATION_ID || conversation.type === 'team') return true;
    if (canModerate) return true;

    const participantIds = Array.isArray(conversation.participantIds) ? conversation.participantIds : [];
    return participantIds.includes(user?.uid) ||
        (user?.uid && participantIds.includes(`user:${user.uid}`)) ||
        (user?.email && participantIds.includes(`email:${String(user.email).toLowerCase()}`));
}

export function getConversationDisplayName(conversation, team = {}) {
    if (!conversation) return 'Team Chat';
    if (conversation.name) return conversation.name;
    if (conversation.id === DEFAULT_TEAM_CONVERSATION_ID || conversation.type === 'team') {
        return team?.name ? `${team.name} Team Chat` : 'Team Chat';
    }
    if (conversation.type === 'direct') return 'Direct conversation';
    return 'Group conversation';
}
