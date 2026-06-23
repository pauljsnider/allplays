import {
    calculateEarnings as legacyCalculateEarnings,
    getApplicableRulesForGame as legacyGetApplicableRulesForGame,
    getCapSetting as legacyGetCapSetting,
    getIncentiveRules as legacyGetIncentiveRules,
    getPaidGames as legacyGetPaidGames,
    getStatOptionsForTeam as legacyGetStatOptionsForTeam,
    isCurrentRuleVersion as legacyIsCurrentRuleVersion,
    markGamePaid as legacyMarkGamePaid,
    retireIncentiveRule as legacyRetireIncentiveRule,
    saveCapSetting as legacySaveCapSetting,
    saveIncentiveRule as legacySaveIncentiveRule,
    toggleIncentiveRule as legacyToggleIncentiveRule
} from '@legacy/parent-incentives.js';
import { buildAthleteProfileShareUrl as legacyBuildAthleteProfileShareUrl } from '@legacy/athlete-profile-utils.js';
import { collectPlayerVideoClips as legacyCollectPlayerVideoClips } from '@legacy/player-profile-stats.js';
import { getVisiblePlayerTrackingSummary as legacyGetVisiblePlayerTrackingSummary } from '@legacy/player-tracking-summary.js';

type LegacyRecord = Record<string, unknown>;

export type PlayerIncentiveRule = {
    id?: string;
    statKey: string;
    type: 'per_unit' | 'threshold';
    amountCents: number;
    threshold: number | null;
    thresholdOp: 'gt' | 'gte' | null;
    active: boolean;
    effectiveFrom?: unknown;
    effectiveTo?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
    [key: string]: unknown;
};
export type PlayerPaidGameRecord = {
    gameId: string;
    amountCents: number;
    paidAt?: unknown;
    [key: string]: unknown;
};
export type PlayerStatOption = { key: string; label: string };
export type PlayerVideoClip = {
    id: string;
    title: string;
    gameDate: string;
    playLabel: string;
    url: string;
    thumbnailUrl: string;
    gameLabel: string;
    [key: string]: unknown;
};
export type PlayerTrackingStatus = LegacyRecord;
export type PlayerTrackingSummaryItem = {
    id: string;
    title: string;
    description: string;
    sortOrder: number;
    isPublic: boolean;
    status: PlayerTrackingStatus | null;
    isComplete: boolean;
    [key: string]: unknown;
};
export type PlayerTrackingSummary = {
    playerId: string;
    items: PlayerTrackingSummaryItem[];
    [key: string]: unknown;
};
export type PlayerEarningsBreakdownItem = {
    rule?: PlayerIncentiveRule | LegacyRecord;
    statValue: number;
    earned: number;
    [key: string]: unknown;
};
export type PlayerCalculatedEarnings = {
    totalCents: number;
    uncappedTotalCents: number;
    wasCapped: boolean;
    breakdown: PlayerEarningsBreakdownItem[];
};

export type LegacyIncentiveRule = PlayerIncentiveRule;
export type LegacyPaidGameRecord = PlayerPaidGameRecord;
export type LegacyStatOption = PlayerStatOption;
export type LegacyPlayerClip = PlayerVideoClip;
export type LegacyTrackingSummaryItem = PlayerTrackingSummaryItem;
export type LegacyCalculatedEarnings = PlayerCalculatedEarnings;

function isRecord(value: unknown): value is LegacyRecord {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value: unknown): string {
    return String(value ?? '').trim();
}

function finiteNumber(value: unknown, fallback = 0): number {
    const parsed = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function finiteNullableNumber(value: unknown): number | null {
    if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function normalizeIncentiveRule(value: unknown): PlayerIncentiveRule | null {
    if (!isRecord(value)) return null;

    const type = value.type === 'threshold' ? 'threshold' : 'per_unit';
    const thresholdOp = type === 'threshold'
        ? (value.thresholdOp === 'gte' ? 'gte' : 'gt')
        : null;

    return {
        ...value,
        id: cleanString(value.id || value.ruleId) || undefined,
        statKey: cleanString(value.statKey || value.key),
        type,
        amountCents: finiteNumber(value.amountCents),
        threshold: type === 'threshold' ? finiteNumber(value.threshold) : null,
        thresholdOp,
        active: value.active !== false
    };
}

function normalizeIncentiveRules(value: unknown): PlayerIncentiveRule[] {
    return asArray(value).map(normalizeIncentiveRule).filter((rule): rule is PlayerIncentiveRule => !!rule);
}

function normalizePaidGameRecord(value: unknown, fallbackGameId = ''): PlayerPaidGameRecord | null {
    if (!isRecord(value)) return null;
    const gameId = cleanString(value.gameId || value.id || fallbackGameId);
    if (!gameId) return null;
    return {
        ...value,
        gameId,
        amountCents: finiteNumber(value.amountCents)
    };
}

function normalizePaidGameMap(value: unknown): Map<string, PlayerPaidGameRecord> {
    const paidGames = new Map<string, PlayerPaidGameRecord>();

    if (value instanceof Map) {
        value.forEach((record, key) => {
            const paidGame = normalizePaidGameRecord(record, cleanString(key));
            if (paidGame) paidGames.set(paidGame.gameId, paidGame);
        });
        return paidGames;
    }

    if (Array.isArray(value)) {
        value.forEach((record) => {
            const paidGame = normalizePaidGameRecord(record);
            if (paidGame) paidGames.set(paidGame.gameId, paidGame);
        });
        return paidGames;
    }

    if (isRecord(value)) {
        Object.entries(value).forEach(([key, record]) => {
            const paidGame = normalizePaidGameRecord(record, key);
            if (paidGame) paidGames.set(paidGame.gameId, paidGame);
        });
    }

    return paidGames;
}

function normalizeStatOption(value: unknown): PlayerStatOption | null {
    if (!isRecord(value)) return null;
    const key = cleanString(value.key || value.statKey || value.id);
    if (!key) return null;
    return {
        key,
        label: cleanString(value.label || value.name || key) || key
    };
}

function normalizeStatOptions(value: unknown): PlayerStatOption[] {
    return asArray(value).map(normalizeStatOption).filter((option): option is PlayerStatOption => !!option);
}

function normalizeEarningsBreakdownItem(value: unknown): PlayerEarningsBreakdownItem | null {
    if (!isRecord(value)) return null;
    return {
        ...value,
        statValue: finiteNumber(value.statValue),
        earned: finiteNumber(value.earned)
    };
}

function normalizeCalculatedEarnings(value: unknown): PlayerCalculatedEarnings {
    const record = isRecord(value) ? value : {};
    return {
        totalCents: finiteNumber(record.totalCents),
        uncappedTotalCents: finiteNumber(record.uncappedTotalCents),
        wasCapped: record.wasCapped === true,
        breakdown: asArray(record.breakdown)
            .map(normalizeEarningsBreakdownItem)
            .filter((item): item is PlayerEarningsBreakdownItem => !!item)
    };
}

function normalizeVideoClip(value: unknown, index: number): PlayerVideoClip | null {
    if (!isRecord(value)) return null;
    const url = cleanString(value.url);
    if (!url) return null;
    const id = cleanString(value.id || value.clipId) || `clip-${index + 1}`;
    return {
        ...value,
        id,
        title: cleanString(value.title) || 'Game clip',
        gameDate: cleanString(value.gameDate),
        playLabel: cleanString(value.playLabel) || 'Highlight',
        url,
        thumbnailUrl: cleanString(value.thumbnailUrl),
        gameLabel: cleanString(value.gameLabel) || 'Game'
    };
}

function normalizeVideoClips(value: unknown): PlayerVideoClip[] {
    return asArray(value).map(normalizeVideoClip).filter((clip): clip is PlayerVideoClip => !!clip);
}

function normalizeTrackingStatus(value: unknown): PlayerTrackingStatus | null {
    return isRecord(value) ? value : null;
}

function normalizeTrackingSummaryItem(value: unknown, index: number): PlayerTrackingSummaryItem | null {
    if (!isRecord(value)) return null;
    const id = cleanString(value.id || value.itemId || value.trackingItemId) || `item-${index + 1}`;
    const status = normalizeTrackingStatus(value.status);
    return {
        ...value,
        id,
        title: cleanString(value.title || value.name || value.label) || 'Tracking item',
        description: cleanString(value.description || value.note),
        sortOrder: Number.isFinite(Number(value.sortOrder)) ? Number(value.sortOrder) : 9999,
        isPublic: value.isPublic === true || value.public === true,
        status,
        isComplete: value.isComplete === true || status?.isComplete === true
    };
}

function normalizeTrackingSummary(value: unknown): PlayerTrackingSummary | null {
    if (!isRecord(value)) return null;
    return {
        ...value,
        playerId: cleanString(value.playerId || value.childId || value.memberId),
        items: asArray(value.items)
            .map(normalizeTrackingSummaryItem)
            .filter((item): item is PlayerTrackingSummaryItem => !!item)
    };
}

export async function getIncentiveRules(userId: string, playerId: string): Promise<PlayerIncentiveRule[]> {
    const rules = await Promise.resolve(legacyGetIncentiveRules(userId, playerId));
    return normalizeIncentiveRules(rules);
}

export async function getPaidGames(userId: string, playerId: string): Promise<Map<string, PlayerPaidGameRecord>> {
    const paidGames = await Promise.resolve(legacyGetPaidGames(userId, playerId));
    return normalizePaidGameMap(paidGames);
}

export async function getCapSetting(userId: string, playerId: string): Promise<number | null> {
    const capSetting = await Promise.resolve(legacyGetCapSetting(userId, playerId));
    return finiteNullableNumber(capSetting);
}

export async function getStatOptionsForTeam(teamId: string): Promise<PlayerStatOption[]> {
    const statOptions = await Promise.resolve(legacyGetStatOptionsForTeam(teamId));
    return normalizeStatOptions(statOptions);
}

export function getApplicableRulesForGame(rules: PlayerIncentiveRule[], date: Date): PlayerIncentiveRule[] {
    return normalizeIncentiveRules(legacyGetApplicableRulesForGame(rules, date));
}

export function calculateEarnings(rules: PlayerIncentiveRule[], stats: Record<string, unknown>, maxPerGameCents: number | null): PlayerCalculatedEarnings {
    return normalizeCalculatedEarnings(legacyCalculateEarnings(rules, stats, maxPerGameCents));
}

export function isCurrentRuleVersion(rule: PlayerIncentiveRule): boolean {
    return legacyIsCurrentRuleVersion(rule) === true;
}

export async function markGamePaid(userId: string, gameId: string, playerId: string, teamId: string, amountCents: number) {
    return await Promise.resolve(legacyMarkGamePaid(userId, gameId, playerId, teamId, amountCents));
}

export async function saveCapSetting(userId: string, teamId: string, playerId: string, maxPerGameCents: number | null) {
    return await Promise.resolve(legacySaveCapSetting(userId, teamId, playerId, maxPerGameCents));
}

export async function saveIncentiveRule(userId: string, rule: Record<string, unknown>) {
    return await Promise.resolve(legacySaveIncentiveRule(userId, rule));
}

export async function toggleIncentiveRule(userId: string, rule: PlayerIncentiveRule) {
    return await Promise.resolve(legacyToggleIncentiveRule(userId, rule));
}

export async function retireIncentiveRule(userId: string, ruleId: string) {
    return await Promise.resolve(legacyRetireIncentiveRule(userId, ruleId));
}

export function buildAthleteProfileShareUrl(origin: string, profileId: string): string {
    return cleanString(legacyBuildAthleteProfileShareUrl(origin, profileId));
}

export function collectPlayerVideoClips(games: unknown, input: { teamId: string; playerId: string }): PlayerVideoClip[] {
    return normalizeVideoClips(legacyCollectPlayerVideoClips(asArray(games), input));
}

export function getVisiblePlayerTrackingSummary(input: {
    items: unknown;
    statuses: unknown;
    playerIds: string[];
}): PlayerTrackingSummary[] {
    return asArray(legacyGetVisiblePlayerTrackingSummary({
        items: asArray(input.items),
        statuses: asArray(input.statuses),
        playerIds: input.playerIds
    }))
        .map(normalizeTrackingSummary)
        .filter((summary): summary is PlayerTrackingSummary => !!summary);
}
