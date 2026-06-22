import {
    getAggregatedStatsForPlayer as legacyGetAggregatedStatsForPlayer,
    getGames as legacyGetGames,
    getPlayerPrivateProfile as legacyGetPlayerPrivateProfile,
    getPlayerTrackingStatuses as legacyGetPlayerTrackingStatuses,
    getPlayers as legacyGetPlayers,
    getPublicTrackingItems as legacyGetPublicTrackingItems,
    getRosterFieldDefinitions as legacyGetRosterFieldDefinitions,
    getTeam as legacyGetTeam,
    deleteAthleteProfileMediaByPath as legacyDeleteAthleteProfileMediaByPath,
    inviteCoParentToAthlete as legacyInviteCoParentToAthlete,
    listAthleteProfilesForParent as legacyListAthleteProfilesForParent,
    listCertificatesForPlayer as legacyListCertificatesForPlayer,
    saveAthleteProfile as legacySaveAthleteProfile,
    setPlayerPrivateRosterProfileFields as legacySetPlayerPrivateRosterProfileFields,
    updatePlayer as legacyUpdatePlayer,
    updatePlayerProfile as legacyUpdatePlayerProfile,
    uploadAthleteProfileMedia as legacyUploadAthleteProfileMedia,
    uploadPlayerPhoto as legacyUploadPlayerPhoto
} from '@legacy/db.js';

export type LegacyTeamRecord = {
    id?: string;
    name?: string;
    ownerId?: string;
    adminEmails?: string[];
    [key: string]: any;
};

export type LegacyPlayerRecord = {
    id?: string;
    name?: string;
    number?: string | null;
    photoUrl?: string | null;
    teamName?: string;
    profile?: {
        customFields?: Record<string, unknown>;
        rosterFields?: Record<string, unknown>;
        [key: string]: any;
    };
    rosterFieldValues?: Record<string, unknown>;
    customFields?: Record<string, unknown>;
    [key: string]: any;
};

export type LegacyPlayerPrivateProfileRecord = {
    emergencyContact?: {
        name?: string | null;
        phone?: string | null;
    } | null;
    medicalInfo?: string | null;
    rosterFields?: Record<string, unknown>;
    [key: string]: any;
};

export type LegacyCertificateRecord = Record<string, any>;
export type LegacyTrackingItemRecord = Record<string, any>;
export type LegacyTrackingStatusRecord = Record<string, any>;
export type LegacyGameRecord = Record<string, any>;
export type LegacyAthleteProfileRecord = {
    id?: string;
    seasons?: Array<{ teamId?: string; playerId?: string; [key: string]: any }>;
    [key: string]: any;
};

export async function getTeam(teamId: string, options?: { includeInactive?: boolean }): Promise<LegacyTeamRecord | null> {
    return await Promise.resolve(legacyGetTeam(teamId, options)).catch(() => null);
}

export async function getPlayers(teamId: string, options?: { includeInactive?: boolean }): Promise<LegacyPlayerRecord[]> {
    return await Promise.resolve(legacyGetPlayers(teamId, options));
}

export async function getGames(teamId: string): Promise<LegacyGameRecord[]> {
    return await Promise.resolve(legacyGetGames(teamId));
}

export async function listCertificatesForPlayer(teamId: string, playerId: string, options?: { status?: string; limit?: number }): Promise<LegacyCertificateRecord[]> {
    return await Promise.resolve(legacyListCertificatesForPlayer(teamId, playerId, options));
}

export async function getPublicTrackingItems(teamId: string): Promise<LegacyTrackingItemRecord[]> {
    return await Promise.resolve(legacyGetPublicTrackingItems(teamId));
}

export async function getPlayerTrackingStatuses(teamId: string, playerIds: string[]): Promise<LegacyTrackingStatusRecord[]> {
    return await Promise.resolve(legacyGetPlayerTrackingStatuses(teamId, playerIds));
}

export async function getPlayerPrivateProfile(teamId: string, playerId: string): Promise<LegacyPlayerPrivateProfileRecord | null> {
    return await Promise.resolve(legacyGetPlayerPrivateProfile(teamId, playerId));
}

export async function getRosterFieldDefinitions(teamId: string, team: LegacyTeamRecord | null) {
    return await Promise.resolve(legacyGetRosterFieldDefinitions(teamId, team));
}

export async function getAggregatedStatsForPlayer(teamId: string, gameId: string, playerId: string): Promise<Record<string, unknown>> {
    return await Promise.resolve(legacyGetAggregatedStatsForPlayer(teamId, gameId, playerId));
}

export async function listAthleteProfilesForParent(userId: string): Promise<LegacyAthleteProfileRecord[]> {
    return await Promise.resolve(legacyListAthleteProfilesForParent(userId));
}

export async function updatePlayer(teamId: string, playerId: string, payload: Record<string, unknown>) {
    return await Promise.resolve(legacyUpdatePlayer(teamId, playerId, payload));
}

export async function setPlayerPrivateRosterProfileFields(teamId: string, playerId: string, values: Record<string, unknown>) {
    return await Promise.resolve(legacySetPlayerPrivateRosterProfileFields(teamId, playerId, values));
}

export async function updatePlayerProfile(teamId: string, playerId: string, payload: Record<string, unknown>) {
    return await Promise.resolve(legacyUpdatePlayerProfile(teamId, playerId, payload));
}

export async function uploadPlayerPhoto(file: File): Promise<string> {
    return await Promise.resolve(legacyUploadPlayerPhoto(file));
}

export async function inviteCoParentToAthlete(userId: string, teamId: string, playerId: string, email: string, playerName: string) {
    return await Promise.resolve(legacyInviteCoParentToAthlete(userId, teamId, playerId, email, playerName));
}

export async function saveAthleteProfile(userId: string, draft: Record<string, unknown>, options: { profileId: string }) {
    return await Promise.resolve(legacySaveAthleteProfile(userId, draft, options));
}

export async function uploadAthleteProfileMedia(userId: string, profileId: string, file: File, options: { kind: 'profile-photo' | 'clip' }) {
    return await Promise.resolve(legacyUploadAthleteProfileMedia(userId, profileId, file, options));
}

export async function deleteAthleteProfileMediaByPath(storagePath: string) {
    return await Promise.resolve(legacyDeleteAthleteProfileMediaByPath(storagePath));
}
