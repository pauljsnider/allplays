import { listParentTeamFeeRecipients } from '../../../../js/db.js';
import { normalizeParentFeeRecord } from '../../../../js/parent-dashboard-fees.js';
import { loadChatInbox } from './chatService';
import {
  buildParentHomeModel,
  type ParentHomeInboxTeam,
  type ParentHomeModel
} from './homeLogic';
import { loadCachedAppData } from './appDataCache';
import { loadParentSchedule, type ParentScheduleLoadResult } from './scheduleService';
import type { AuthUser } from './types';

const homeSummaryTtlMs = 45 * 1000;
const homeSecondaryTtlMs = 30 * 1000;

export async function loadParentHome(user: AuthUser | null): Promise<ParentHomeModel> {
  if (!user?.uid) {
    return buildParentHomeModel({ children: [], events: [], inboxTeams: [], fees: [] });
  }

  const schedule = await loadParentScheduleSummary(user);
  const [chatInbox, rawFees] = await Promise.all([
    loadChatInbox(user).catch((error) => {
      console.warn('[home-service] Unable to load chat inbox:', error);
      return { teams: [] };
    }),
    Promise.resolve(listParentTeamFeeRecipients(user.uid, schedule.children)).catch((error) => {
      console.warn('[home-service] Unable to load parent team fees:', error);
      return [];
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
  if (!user?.uid) {
    return buildParentHomeModel({ children: [], events: [], inboxTeams: [], fees: [] });
  }

  const schedule = await loadParentScheduleSummary(user, options);
  return buildParentHomeModel({
    children: schedule.children,
    events: schedule.events,
    inboxTeams: [],
    fees: []
  });
}

export async function loadParentHomeWithSecondaryData(user: AuthUser | null, options: { force?: boolean } = {}): Promise<ParentHomeModel> {
  if (!user?.uid) {
    return buildParentHomeModel({ children: [], events: [], inboxTeams: [], fees: [] });
  }

  const cacheKey = `home-secondary:${user.uid}`;
  return loadCachedAppData(cacheKey, async () => loadParentHome(user), { ttlMs: homeSecondaryTtlMs, force: options.force });
}

export async function loadParentScheduleSummary(user: AuthUser | null, options: { force?: boolean } = {}): Promise<ParentScheduleLoadResult> {
  if (!user?.uid) return { children: [], events: [] };
  return loadCachedAppData(
    `schedule-summary:${user.uid}`,
    () => loadParentSchedule(user, { hydrateDetails: false }),
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
