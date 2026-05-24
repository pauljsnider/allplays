import {
  getOpenScheduleAssignments,
  getScheduleTitle,
  normalizeRsvpResponse,
  type ParentScheduleEvent
} from './scheduleLogic';
import type { ParentScheduleChild } from './scheduleService';

export type HomeActionKind = 'rsvp' | 'packet' | 'assignment' | 'rideshare' | 'fee' | 'message';
export type HomeActionTone = 'amber' | 'blue' | 'emerald' | 'rose' | 'gray';

export type ParentHomeFee = {
  id?: string;
  title?: string;
  teamId?: string;
  teamName?: string;
  playerId?: string;
  playerName?: string;
  status?: string;
  dueDate?: unknown;
  balanceDueCents?: number | string | null;
  totalAmountCents?: number | string | null;
  checkoutUrl?: string | null;
};

export type ParentHomeInboxTeam = {
  id: string;
  name: string;
  role?: string | null;
  unreadCount?: number;
  sport?: string | null;
  photoUrl?: string | null;
};

export type ParentHomeAction = {
  id: string;
  kind: HomeActionKind;
  tone: HomeActionTone;
  title: string;
  detail: string;
  to: string;
  priority: number;
  date?: Date | null;
};

export type ParentHomePlayer = ParentScheduleChild & {
  nextEvent: ParentScheduleEvent | null;
  rsvpNeeded: number;
  packetsReady: number;
  openAssignments: number;
  unreadCount: number;
};

export type ParentHomeTeam = {
  teamId: string;
  teamName: string;
  role: string;
  sport: string | null;
  photoUrl?: string | null;
  players: ParentScheduleChild[];
  nextEvent: ParentScheduleEvent | null;
  eventCount: number;
  unreadCount: number;
  openActions: number;
};

export type ParentHomeModel = {
  players: ParentHomePlayer[];
  teams: ParentHomeTeam[];
  upcomingEvents: ParentScheduleEvent[];
  actionItems: ParentHomeAction[];
  fees: ParentHomeFee[];
  metrics: {
    players: number;
    teams: number;
    rsvpNeeded: number;
    unreadMessages: number;
    packetsReady: number;
  };
};

export function getPlayerDetailPath(teamId: string, playerId: string) {
  return `/players/${encodeURIComponent(teamId)}/${encodeURIComponent(playerId)}`;
}

export function getTeamHomePath(teamId: string) {
  const params = new URLSearchParams();
  if (teamId) params.set('selectedTeamId', teamId);
  params.set('from', 'home');
  return `/teams?${params.toString()}`;
}

export function getEventDetailPath(event: Pick<ParentScheduleEvent, 'teamId' | 'id' | 'childId'>, section = '') {
  const params = new URLSearchParams();
  if (event.childId) params.set('childId', event.childId);
  if (section) params.set('section', section);
  const query = params.toString();
  return `/schedule/${encodeURIComponent(event.teamId)}/${encodeURIComponent(event.id)}${query ? `?${query}` : ''}`;
}

export function isUpcomingHomeEvent(event: ParentScheduleEvent, now = new Date()) {
  return !event.isCancelled && event.date.getTime() >= startOfDay(now).getTime();
}

export function getUpcomingHomeEvents(events: ParentScheduleEvent[], limit = 5, now = new Date()) {
  return dedupeEvents(events.filter((event) => isUpcomingHomeEvent(event, now)))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, limit);
}

export function buildParentHomeModel({
  children,
  events,
  inboxTeams = [],
  fees = [],
  now = new Date()
}: {
  children: ParentScheduleChild[];
  events: ParentScheduleEvent[];
  inboxTeams?: ParentHomeInboxTeam[];
  fees?: ParentHomeFee[];
  now?: Date;
}): ParentHomeModel {
  const inboxByTeamId = new Map(inboxTeams.map((team) => [team.id, team]));
  const players = buildHomePlayers(children, events, inboxByTeamId, now);
  const teams = buildHomeTeams(children, events, inboxByTeamId, now);
  const actionItems = buildHomeActionItems({ events, fees, inboxTeams, now });
  const upcomingEvents = getUpcomingHomeEvents(events, 5, now);
  const openFees = getOpenFees(fees);

  return {
    players,
    teams,
    upcomingEvents,
    actionItems,
    fees: openFees,
    metrics: {
      players: players.length,
      teams: teams.length,
      rsvpNeeded: actionItems.filter((item) => item.kind === 'rsvp').length,
      unreadMessages: inboxTeams.reduce((total, team) => total + Number(team.unreadCount || 0), 0),
      packetsReady: actionItems.filter((item) => item.kind === 'packet').length
    }
  };
}

export function buildHomeActionItems({
  events,
  fees = [],
  inboxTeams = [],
  now = new Date()
}: {
  events: ParentScheduleEvent[];
  fees?: ParentHomeFee[];
  inboxTeams?: ParentHomeInboxTeam[];
  now?: Date;
}): ParentHomeAction[] {
  const upcoming = events.filter((event) => isUpcomingHomeEvent(event, now));
  const actions: ParentHomeAction[] = [];

  upcoming.forEach((event) => {
    const rsvp = normalizeRsvpResponse(event.myRsvp);
    if (event.isDbGame && !event.availabilityLocked && rsvp === 'not_responded') {
      actions.push({
        id: `rsvp:${event.eventKey}`,
        kind: 'rsvp',
        tone: 'amber',
        title: `${event.childName} needs availability`,
        detail: `${event.teamName} ${getScheduleTitle(event)} · ${formatHomeActionDate(event.date)}`,
        to: getEventDetailPath(event, 'availability'),
        priority: 10,
        date: event.date
      });
    }

    if (event.type === 'practice' && event.practiceHomePacketSummary) {
      actions.push({
        id: `packet:${event.eventKey}`,
        kind: 'packet',
        tone: 'blue',
        title: 'Practice packet ready',
        detail: `${event.childName} · ${event.practiceHomePacketSummary}`,
        to: getEventDetailPath(event, 'game'),
        priority: 20,
        date: event.date
      });
    }

    const openAssignments = getOpenScheduleAssignments(event.assignments);
    if (openAssignments.length > 0) {
      actions.push({
        id: `assignment:${event.eventKey}`,
        kind: 'assignment',
        tone: 'emerald',
        title: `${openAssignments.length} open assignment${openAssignments.length === 1 ? '' : 's'}`,
        detail: `${event.teamName} ${getScheduleTitle(event)} · ${openAssignments.map((assignment) => assignment.role).filter(Boolean).join(', ')}`,
        to: getEventDetailPath(event, 'assignments'),
        priority: 30,
        date: event.date
      });
    }

    const rideSummary = event.rideshareSummary;
    if (rideSummary && (rideSummary.pending > 0 || rideSummary.requests > 0)) {
      actions.push({
        id: `rideshare:${event.teamId}:${event.id}`,
        kind: 'rideshare',
        tone: 'gray',
        title: 'Rideshare activity',
        detail: `${rideSummary.requests} request${rideSummary.requests === 1 ? '' : 's'} · ${rideSummary.seatsLeft} seats left`,
        to: getEventDetailPath(event, 'rideshare'),
        priority: 40,
        date: event.date
      });
    }
  });

  getOpenFees(fees).slice(0, 3).forEach((fee) => {
    actions.push({
      id: `fee:${fee.id || fee.teamId || fee.title}`,
      kind: 'fee',
      tone: 'rose',
      title: fee.title || 'Team fee',
      detail: `${fee.teamName || 'Team'}${fee.playerName ? ` · ${fee.playerName}` : ''}${fee.balanceDueCents !== undefined && fee.balanceDueCents !== null ? ` · ${formatHomeCurrency(fee.balanceDueCents)} due` : ''}`,
      to: '/parent-tools/fees',
      priority: 50,
      date: toDate(fee.dueDate)
    });
  });

  inboxTeams
    .filter((team) => Number(team.unreadCount || 0) > 0)
    .sort((a, b) => Number(b.unreadCount || 0) - Number(a.unreadCount || 0))
    .slice(0, 3)
    .forEach((team) => {
      actions.push({
        id: `message:${team.id}`,
        kind: 'message',
        tone: 'blue',
        title: `${team.unreadCount} unread message${Number(team.unreadCount) === 1 ? '' : 's'}`,
        detail: team.name || 'Team chat',
        to: `/messages/${encodeURIComponent(team.id)}`,
        priority: 60,
        date: null
      });
    });

  return actions.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return (a.date?.getTime() || Number.MAX_SAFE_INTEGER) - (b.date?.getTime() || Number.MAX_SAFE_INTEGER);
  });
}

function buildHomePlayers(children: ParentScheduleChild[], events: ParentScheduleEvent[], inboxByTeamId: Map<string, ParentHomeInboxTeam>, now: Date): ParentHomePlayer[] {
  return children.map((child) => {
    const playerEvents = events.filter((event) => event.teamId === child.teamId && event.childId === child.playerId);
    const upcoming = playerEvents.filter((event) => isUpcomingHomeEvent(event, now));
    return {
      ...child,
      nextEvent: getUpcomingHomeEvents(playerEvents, 1, now)[0] || null,
      rsvpNeeded: upcoming.filter((event) => event.isDbGame && !event.availabilityLocked && normalizeRsvpResponse(event.myRsvp) === 'not_responded').length,
      packetsReady: upcoming.filter((event) => event.type === 'practice' && event.practiceHomePacketSummary).length,
      openAssignments: upcoming.reduce((total, event) => total + getOpenScheduleAssignments(event.assignments).length, 0),
      unreadCount: Number(inboxByTeamId.get(child.teamId)?.unreadCount || 0)
    };
  }).sort((a, b) => {
    const actionDiff = getPlayerActionCount(b) - getPlayerActionCount(a);
    if (actionDiff) return actionDiff;
    return String(a.playerName || '').localeCompare(String(b.playerName || ''));
  });
}

function buildHomeTeams(children: ParentScheduleChild[], events: ParentScheduleEvent[], inboxByTeamId: Map<string, ParentHomeInboxTeam>, now: Date): ParentHomeTeam[] {
  const byTeam = new Map<string, ParentHomeTeam>();
  children.forEach((child) => {
    const inbox = inboxByTeamId.get(child.teamId);
    if (!byTeam.has(child.teamId)) {
      const teamEvents = events.filter((event) => event.teamId === child.teamId);
      byTeam.set(child.teamId, {
        teamId: child.teamId,
        teamName: inbox?.name || child.teamName || child.teamId,
        role: inbox?.role || 'Parent',
        sport: inbox?.sport || null,
        photoUrl: inbox?.photoUrl || null,
        players: [],
        nextEvent: getUpcomingHomeEvents(teamEvents, 1, now)[0] || null,
        eventCount: dedupeEvents(teamEvents).length,
        unreadCount: Number(inbox?.unreadCount || 0),
        openActions: 0
      });
    }
    byTeam.get(child.teamId)?.players.push(child);
  });

  inboxByTeamId.forEach((inbox, teamId) => {
    if (byTeam.has(teamId)) return;
    byTeam.set(teamId, {
      teamId,
      teamName: inbox.name || teamId,
      role: inbox.role || 'Team',
      sport: inbox.sport || null,
      photoUrl: inbox.photoUrl || null,
      players: [],
      nextEvent: null,
      eventCount: 0,
      unreadCount: Number(inbox.unreadCount || 0),
      openActions: Number(inbox.unreadCount || 0) > 0 ? 1 : 0
    });
  });

  byTeam.forEach((team) => {
    const teamEvents = events.filter((event) => event.teamId === team.teamId && isUpcomingHomeEvent(event, now));
    team.openActions = teamEvents.reduce((total, event) => {
      const needsRsvp = event.isDbGame && !event.availabilityLocked && normalizeRsvpResponse(event.myRsvp) === 'not_responded' ? 1 : 0;
      const packet = event.type === 'practice' && event.practiceHomePacketSummary ? 1 : 0;
      return total + needsRsvp + packet + getOpenScheduleAssignments(event.assignments).length;
    }, team.unreadCount > 0 ? 1 : 0);
  });

  return [...byTeam.values()].sort((a, b) => {
    const unreadDiff = Number(b.unreadCount > 0) - Number(a.unreadCount > 0);
    if (unreadDiff) return unreadDiff;
    return a.teamName.localeCompare(b.teamName);
  });
}

function getOpenFees(fees: ParentHomeFee[]) {
  return (Array.isArray(fees) ? fees : []).filter((fee) => {
    const status = String(fee.status || '').toLowerCase();
    if (status === 'paid' || status === 'canceled' || status === 'cancelled') return false;
    const balance = Number(fee.balanceDueCents);
    if (Number.isFinite(balance)) return balance > 0;
    return status === 'unpaid' || status === 'partial' || status === 'partially_paid';
  });
}

function dedupeEvents(events: ParentScheduleEvent[]) {
  const byId = new Map<string, ParentScheduleEvent>();
  events.forEach((event) => {
    const key = `${event.teamId}::${event.id}::${event.date.toISOString()}`;
    if (!byId.has(key)) byId.set(key, event);
  });
  return [...byId.values()];
}

function getPlayerActionCount(player: Pick<ParentHomePlayer, 'rsvpNeeded' | 'packetsReady' | 'openAssignments' | 'unreadCount'>) {
  return player.rsvpNeeded + player.packetsReady + player.openAssignments + (player.unreadCount > 0 ? 1 : 0);
}

function startOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function toDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof (value as { toDate?: unknown }).toDate === 'function') {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatHomeActionDate(date: Date) {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatHomeCurrency(value: number | string) {
  const cents = Number(value);
  if (!Number.isFinite(cents)) return 'Balance';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}
