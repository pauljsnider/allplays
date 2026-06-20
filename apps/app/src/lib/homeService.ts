import { listParentTeamFeeRecipients } from '../../../../js/db.js';
import { normalizeParentFeeRecord } from '../../../../js/parent-dashboard-fees.js';
import { loadChatInbox } from './chatService';
import { startUxTimer } from './uxTiming';
import {
  buildParentHomeModel,
  type ParentHomeInboxTeam,
  type ParentHomeModel
} from './homeLogic';
import { getParentScheduleSummaryCacheKey, loadCachedAppData } from './appDataCache';
import { toAppServiceError } from './appErrors';
import {
  hydrateParentScheduleDetails,
  loadParentSchedule,
  type ParentScheduleChild,
  type ParentScheduleLoadResult
} from './scheduleService';
import type { AuthUser } from './types';

const homeSummaryTtlMs = 45 * 1000;
const homeSecondaryTtlMs = 30 * 1000;
const teamsSummaryTtlMs = 30 * 1000;

export async function loadParentHome(user: AuthUser | null): Promise<ParentHomeModel> {
  if (!user?.uid) {
    return buildParentHomeModel({ children: [], events: [], inboxTeams: [], fees: [] });
  }

  const schedule = await loadParentScheduleSummary(user);
  const [chatInbox, rawFees] = await Promise.all([
    loadChatInbox(user).catch((error) => {
      throw toAppServiceError(error, 'Unable to load Home chat.');
    }),
    Promise.resolve(listParentTeamFeeRecipients(user.uid, schedule.children)).catch((error) => {
      throw toAppServiceError(error, 'Unable to load Home fees.');
    })
  ]);

  return buildParentHomeModel({
    children: schedule.children,
    events: schedule.events,
    inboxTeams: normalizeInboxTeams(chatInbox.teams || []),
    fees: (rawFees || []).map((fee: any) => normalizeParentFeeRecord(fee))
  });
}

export async function loadParentHomeSummary(user: AuthUser | null, options: { force?: boolean } = {}): Promise<ParentHomeModel> {
  const summary = await loadParentHomeSummaryBootstrap(user, options);
  return summary.home;
}

export async function loadParentHomeSummaryBootstrap(
  user: AuthUser | null,
  options: { force?: boolean } = {}
): Promise<{ home: ParentHomeModel; schedule: ParentScheduleLoadResult }> {
  if (!user?.uid) {
    const schedule = { children: [], events: [] };
    return {
      home: buildParentHomeModel({ children: [], events: [], inboxTeams: [], fees: [] }),
      schedule
    };
  }

  const schedule = await loadParentScheduleSummary(user, options);
  return {
    home: buildParentHomeModel({
      children: schedule.children,
      events: schedule.events,
      inboxTeams: [],
      fees: []
    }),
    schedule
  };
}

export async function loadParentTeamsSummary(user: AuthUser | null, options: { force?: boolean } = {}): Promise<ParentHomeModel> {
  if (!user?.uid) {
    return buildParentHomeModel({ children: [], events: [], inboxTeams: [], fees: [] });
  }

  return loadCachedAppData(
    `teams-summary:${user.uid}`,
    async () => {
      const timer = startUxTimer('teams summary load');
      try {
        const chatInbox = await loadChatInbox(user, { includeLastMessages: false }).catch((error) => {
          throw toAppServiceError(error, 'Unable to load teams.');
        });
        const children = normalizeChildLinks(user, { parentOf: user.parentOf || [] });
        const model = buildParentHomeModel({
          children,
          events: [],
          inboxTeams: normalizeInboxTeams(chatInbox.teams || []),
          fees: []
        });
        timer.end({
          children: children.length,
          teams: model.teams.length,
          inboxTeams: chatInbox.teams?.length || 0
        });
        return model;
      } catch (error: any) {
        timer.end({ error: error?.message || 'Unable to load team summary.' });
        throw error;
      }
    },
    { ttlMs: teamsSummaryTtlMs, force: options.force }
  );
}

export async function loadParentHomeWithSecondaryData(
  user: AuthUser | null,
  options: { force?: boolean; schedule?: ParentScheduleLoadResult } = {}
): Promise<ParentHomeModel> {
  if (!user?.uid) {
    return buildParentHomeModel({ children: [], events: [], inboxTeams: [], fees: [] });
  }

  const cacheKey = `home-secondary:${user.uid}`;
  return loadCachedAppData(cacheKey, async () => {
    const schedule = options.schedule || await loadParentScheduleSummary(user, { force: options.force });
    await hydrateParentScheduleDetails(schedule, user);
    const [chatInbox, rawFees] = await Promise.all([
      loadChatInbox(user, { forcePreviews: options.force }).catch((error) => {
        throw toAppServiceError(error, 'Unable to load Home chat.');
      }),
      Promise.resolve(listParentTeamFeeRecipients(user.uid, schedule.children)).catch((error) => {
        throw toAppServiceError(error, 'Unable to load Home fees.');
      })
    ]);
    return buildParentHomeModel({
      children: schedule.children,
      events: schedule.events,
      inboxTeams: normalizeInboxTeams(chatInbox.teams || []),
      fees: (rawFees || []).map((fee: any) => normalizeParentFeeRecord(fee))
    });
  }, { ttlMs: homeSecondaryTtlMs, force: options.force });
}

export async function loadParentScheduleSummary(user: AuthUser | null, options: { force?: boolean } = {}): Promise<ParentScheduleLoadResult> {
  if (!user?.uid) return { children: [], events: [] };
  return loadCachedAppData(
    getParentScheduleSummaryCacheKey(user.uid),
    () => loadParentSchedule(user, { hydrateDetails: false, expandStaffPlayers: false }),
    { ttlMs: homeSummaryTtlMs, force: options.force }
  );
}

function normalizeInboxTeams(teams: any[]): ParentHomeInboxTeam[] {
  return (teams || []).map((team: any) => ({
    id: team.id,
    name: team.name || 'Team',
    role: team.role || 'Parent',
    sport: team.sport || null,
    photoUrl: team.photoUrl || null,
    unreadCount: Number(team.unreadCount || 0)
  }));
}

function compactString(value: unknown) {
  return String(value || '').trim();
}

function normalizeChildLinks(user: AuthUser, profile: Record<string, unknown>): ParentScheduleChild[] {
  const parentOf = Array.isArray(profile.parentOf) && profile.parentOf.length > 0
    ? profile.parentOf
    : Array.isArray(user.parentOf) ? user.parentOf : [];

  const seen = new Set<string>();
  return parentOf
    .map((entry: any) => {
      const teamId = compactString(entry?.teamId);
      const playerId = compactString(entry?.playerId || entry?.childId);
      if (!teamId || !playerId) return null;
      const key = `${teamId}::${playerId}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        teamId,
        teamName: compactString(entry?.teamName),
        playerId,
        playerName: compactString(entry?.playerName || entry?.childName || entry?.name) || 'Player'
      };
    })
    .filter(Boolean) as ParentScheduleChild[];
}
