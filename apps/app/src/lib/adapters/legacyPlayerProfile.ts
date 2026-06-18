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
} from '../../../../../js/parent-incentives.js';
import { buildAthleteProfileShareUrl as legacyBuildAthleteProfileShareUrl } from '../../../../../js/athlete-profile-utils.js';
import { collectPlayerVideoClips as legacyCollectPlayerVideoClips } from '../../../../../js/player-profile-stats.js';
import { getVisiblePlayerTrackingSummary as legacyGetVisiblePlayerTrackingSummary } from '../../../../../js/player-tracking-summary.js';

export type LegacyIncentiveRule = Record<string, any>;
export type LegacyPaidGameRecord = Record<string, any>;
export type LegacyStatOption = { key: string; label: string };
export type LegacyPlayerClip = Record<string, any>;
export type LegacyTrackingSummaryItem = Record<string, any>;
export type LegacyCalculatedEarnings = {
    totalCents: number;
    uncappedTotalCents: number;
    wasCapped: boolean;
    breakdown: Array<Record<string, any>>;
};

export async function getIncentiveRules(userId: string, playerId: string): Promise<LegacyIncentiveRule[]> {
    return await Promise.resolve(legacyGetIncentiveRules(userId, playerId));
}

export async function getPaidGames(userId: string, playerId: string): Promise<Map<string, LegacyPaidGameRecord>> {
    return await Promise.resolve(legacyGetPaidGames(userId, playerId));
}

export async function getCapSetting(userId: string, playerId: string): Promise<number | null> {
    return await Promise.resolve(legacyGetCapSetting(userId, playerId));
}

export async function getStatOptionsForTeam(teamId: string): Promise<LegacyStatOption[]> {
    return await Promise.resolve(legacyGetStatOptionsForTeam(teamId));
}

export function getApplicableRulesForGame(rules: LegacyIncentiveRule[], date: Date) {
    return legacyGetApplicableRulesForGame(rules, date) as LegacyIncentiveRule[];
}

export function calculateEarnings(rules: LegacyIncentiveRule[], stats: Record<string, unknown>, maxPerGameCents: number | null): LegacyCalculatedEarnings {
    return legacyCalculateEarnings(rules, stats, maxPerGameCents) as LegacyCalculatedEarnings;
}

export function isCurrentRuleVersion(rule: LegacyIncentiveRule) {
    return legacyIsCurrentRuleVersion(rule);
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

export async function toggleIncentiveRule(userId: string, rule: LegacyIncentiveRule) {
    return await Promise.resolve(legacyToggleIncentiveRule(userId, rule));
}

export async function retireIncentiveRule(userId: string, ruleId: string) {
    return await Promise.resolve(legacyRetireIncentiveRule(userId, ruleId));
}

export function buildAthleteProfileShareUrl(origin: string, profileId: string) {
    return legacyBuildAthleteProfileShareUrl(origin, profileId);
}

export function collectPlayerVideoClips(games: Array<Record<string, any>>, input: { teamId: string; playerId: string }): LegacyPlayerClip[] {
    return legacyCollectPlayerVideoClips(games, input) as LegacyPlayerClip[];
}

export function getVisiblePlayerTrackingSummary(input: {
    items: Array<Record<string, any>>;
    statuses: Array<Record<string, any>>;
    playerIds: string[];
}): LegacyTrackingSummaryItem[] {
    return legacyGetVisiblePlayerTrackingSummary(input) as LegacyTrackingSummaryItem[];
}
