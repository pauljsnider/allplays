import { listParentTeamFeeRecipients } from '../../../../js/db.js';
import { normalizeParentFeeRecord } from '../../../../js/parent-dashboard-fees.js';
import { loadChatInbox } from './chatService';
import {
  buildParentHomeModel,
  type ParentHomeModel
} from './homeLogic';
import { loadParentSchedule } from './scheduleService';
import type { AuthUser } from './types';

export async function loadParentHome(user: AuthUser | null): Promise<ParentHomeModel> {
  if (!user?.uid) {
    return buildParentHomeModel({ children: [], events: [], inboxTeams: [], fees: [] });
  }

  const schedule = await loadParentSchedule(user);
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
    inboxTeams: (chatInbox.teams || []).map((team: any) => ({
      id: team.id,
      name: team.name || 'Team',
      role: team.role || 'Parent',
      sport: team.sport || null,
      photoUrl: team.photoUrl || null,
      unreadCount: Number(team.unreadCount || 0)
    })),
    fees: (rawFees || []).map((fee: any) => normalizeParentFeeRecord(fee))
  });
}
