import { createFamilyShareToken, listFamilyShareTokens, revokeFamilyShareToken, updateFamilyShareTokenCalendars } from './adapters/legacyParentTools';
import type { AuthUser } from './types';

const legacyOrigin = 'https://allplays.ai';

export type FamilyShareTokenCard = Record<string, any> & {
    url: string;
    childCount: number;
};

export async function loadFamilyShareModel(user: AuthUser | null): Promise<{ children: any[]; tokens: FamilyShareTokenCard[] }> {
    if (!user?.uid) return { children: [], tokens: [] };
    const children = normalizeFamilyChildren(user.parentOf || []);
    const tokens = await Promise.resolve(listFamilyShareTokens(user.uid));
    return {
        children,
        tokens: (tokens || []).map((token: any) => ({
            ...token,
            expired: isFamilyShareTokenExpired(token),
            statusLabel: getFamilyShareTokenStatusLabel(token),
            url: getFamilyShareUrl(token.id),
            childCount: Array.isArray(token.children) ? token.children.length : 0
        }))
    };
}

export async function createParentFamilyShare(user: AuthUser | null, label: string, extraCalendarUrls: string[] = []) {
    if (!user?.uid) throw new Error('Sign in before creating a family share link.');
    const tokenId = await createFamilyShareToken(user.uid, normalizeFamilyChildren(user.parentOf || []), label, extraCalendarUrls);
    return { tokenId, url: getFamilyShareUrl(tokenId) };
}

export async function revokeParentFamilyShare(tokenId: string) {
    await revokeFamilyShareToken(tokenId);
}

export async function updateParentFamilyShareCalendars(tokenId: string, urls: string[]) {
    await updateFamilyShareTokenCalendars(tokenId, urls);
}

function getLegacyUrl(path: string, params: Record<string, string> = {}) {
    const url = new URL(path, legacyOrigin);
    Object.entries(params).forEach(([key, value]) => {
        if (value) url.searchParams.set(key, value);
    });
    return url.toString();
}

function getAppUrl(hashPath: string) {
    const url = new URL('app/', legacyOrigin);
    url.hash = hashPath.startsWith('/') ? hashPath : `/${hashPath}`;
    return url.toString();
}

export function getLegacyFamilyShareUrl(tokenId: string) {
    return getLegacyUrl('family.html', { token: tokenId });
}

export function getFamilyShareUrl(tokenId: string) {
    return getAppUrl(`/family/${encodeURIComponent(tokenId)}`);
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

function isFamilyShareTokenExpired(token: unknown) {
    const expiresAt = toMillis(asObject(token).expiresAt);
    return expiresAt > 0 && expiresAt <= Date.now();
}

function getFamilyShareTokenStatusLabel(token: unknown) {
    const data = asObject(token);
    if (data.revokedAt || data.revoked || data.active === false) return 'Revoked';
    if (isFamilyShareTokenExpired(data)) return 'Expired';
    return 'Active';
}

function compactString(value: unknown) {
    return String(value || '').trim();
}

function asObject(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}
