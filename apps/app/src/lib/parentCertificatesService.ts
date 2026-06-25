import { getTeam, listCertificatesForPlayer } from './adapters/legacyParentTools';
import type { AuthUser } from './types';

const legacyOrigin = 'https://allplays.ai';

export type ParentCertificateCard = Record<string, any> & {
    teamId: string;
    teamName: string;
    playerId: string;
    playerName: string;
    url: string;
};

export async function loadParentCertificates(user: AuthUser | null): Promise<ParentCertificateCard[]> {
    const children = normalizeFamilyChildren(user?.parentOf || []);
    const rows = await Promise.all(children.map(async (child: any) => {
        const [team, certificates] = await Promise.all([
            Promise.resolve(getTeam(child.teamId)).catch(() => null),
            Promise.resolve(listCertificatesForPlayer(child.teamId, child.playerId, { status: 'published', limit: 25 })).catch(() => [])
        ]);
        return (certificates || []).map((certificate: any) => ({
            ...certificate,
            teamId: child.teamId,
            teamName: team?.name || child.teamName || 'Team',
            playerId: child.playerId,
            playerName: child.playerName || certificate.recipientName || 'Player',
            url: getCertificateUrl(child.teamId, certificate.id)
        }));
    }));
    return rows.flat().sort((a, b) => {
        const aTime = toMillis(a.updatedAt || a.createdAt);
        const bTime = toMillis(b.updatedAt || b.createdAt);
        return bTime - aTime;
    });
}

function getLegacyUrl(path: string, hashParams: Record<string, string> = {}) {
    const url = new URL(path, legacyOrigin);
    const hash = new URLSearchParams();
    Object.entries(hashParams).forEach(([key, value]) => {
        if (value) hash.set(key, value);
    });
    if ([...hash.keys()].length) url.hash = hash.toString();
    return url.toString();
}

function getCertificateUrl(teamId: string, certificateId: string) {
    return getLegacyUrl('certificates.html', { teamId, certificateId });
}

function normalizeFamilyChildren(children: any[]) {
    return (Array.isArray(children) ? children : [])
        .filter((child) => child?.teamId && child?.playerId)
        .map((child) => ({
            teamId: compactString(child.teamId),
            teamName: compactString(child.teamName),
            playerId: compactString(child.playerId),
            playerName: compactString(child.playerName),
            playerNumber: compactString(child.playerNumber || child.number),
            playerPhotoUrl: child.playerPhotoUrl || null
        }));
}

function toDate(value: unknown): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : typeof (value as any)?.toDate === 'function' ? (value as any).toDate() : new Date(value as any);
    return Number.isNaN(date.getTime()) ? null : date;
}

function toMillis(value: unknown) {
    return toDate(value)?.getTime() || 0;
}

function compactString(value: unknown) {
    return String(value || '').trim();
}
