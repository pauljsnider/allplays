import { getCertificate, getTeam, listCertificatesForPlayer } from './adapters/legacyParentTools';
import type { AuthUser } from './types';

const legacyOrigin = 'https://allplays.ai';
const DEFAULT_PUBLISHED_CERTIFICATE_LIMIT = 25;

export type ParentCertificateCard = Record<string, any> & {
    id: string;
    teamId: string;
    teamName: string;
    playerId: string;
    playerName: string;
    url: string;
};

export type LoadParentCertificatesOptions = {
    includeCertificate?: ParentCertificateCard | null;
};

export async function loadParentCertificates(user: AuthUser | null, options: LoadParentCertificatesOptions = {}): Promise<ParentCertificateCard[]> {
    const children = normalizeFamilyChildren(user?.parentOf || []);
    const teamReads = new Map<string, Promise<any>>();
    const readTeam = (teamId: string) => {
        if (!teamReads.has(teamId)) {
            teamReads.set(teamId, Promise.resolve(getTeam(teamId)).catch(() => null));
        }
        return teamReads.get(teamId)!;
    };
    const rows = await Promise.all(children.map(async (child: any) => {
        const [team, certificates] = await Promise.all([
            readTeam(child.teamId),
            Promise.resolve(listCertificatesForPlayer(child.teamId, child.playerId, { status: 'published', limit: DEFAULT_PUBLISHED_CERTIFICATE_LIMIT }))
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
    const cardsById = new Map<string, ParentCertificateCard>();
    if (options.includeCertificate
        && compactString(options.includeCertificate.status) === 'published'
        && children.some((child) => child.teamId === options.includeCertificate?.teamId && child.playerId === options.includeCertificate?.playerId)) {
        cardsById.set(getCertificateKey(options.includeCertificate), options.includeCertificate);
    }
    rows.flat().forEach((card) => {
        cardsById.set(getCertificateKey(card), card);
    });
    return [...cardsById.values()].sort((a, b) => {
        const aTime = toMillis(a.updatedAt || a.createdAt);
        const bTime = toMillis(b.updatedAt || b.createdAt);
        return bTime - aTime;
    });
}

export async function loadParentCertificate(
    user: AuthUser | null,
    requestedTeamId: string,
    requestedCertificateId: string
): Promise<ParentCertificateCard | null> {
    const teamId = compactString(requestedTeamId);
    const certificateId = compactString(requestedCertificateId);
    const linkedChildren = normalizeFamilyChildren(user?.parentOf || [])
        .filter((child) => child.teamId === teamId);
    if (!teamId || !certificateId || !linkedChildren.length) return null;

    const certificate = await Promise.resolve(getCertificate(teamId, certificateId));
    if (!certificate || compactString(certificate.status) !== 'published') return null;
    if (compactString(certificate.id) !== certificateId) return null;
    if (certificate.teamId && compactString(certificate.teamId) !== teamId) return null;
    const child = linkedChildren.find((entry) => entry.playerId === compactString(certificate.playerId));
    if (!child) return null;

    return {
        ...certificate,
        teamId,
        teamName: child.teamName || 'Team',
        playerId: child.playerId,
        playerName: child.playerName || certificate.recipientName || 'Player',
        url: getCertificateUrl(teamId, certificateId)
    };
}

function getCertificateKey(certificate: Pick<ParentCertificateCard, 'teamId' | 'id'>) {
    return `${compactString(certificate.teamId)}::${compactString(certificate.id)}`;
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
