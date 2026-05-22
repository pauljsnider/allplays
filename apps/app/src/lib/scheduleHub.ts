import {
  formatEventDateLabel,
  formatEventTimeLabel,
  getScheduleTitle,
  type ParentScheduleEvent
} from './scheduleLogic';

export type ScheduleHubIcon = 'video' | 'radio' | 'file-text' | 'share' | 'clipboard-check' | 'users';

export type ScheduleHubDestination = {
  id: string;
  title: string;
  detail: string;
  icon: ScheduleHubIcon;
  url?: string;
  actionLabel: string;
  actionKind?: 'open' | 'share';
  shareLabel: string;
  shareTitle: string;
  shareText: string;
  shareUrl?: string | null;
  hideShareButton?: boolean;
  badge?: string;
};

export function buildGameHubDestinations(event: ParentScheduleEvent): ScheduleHubDestination[] {
  const liveStatus = String(event.liveStatus || '').toLowerCase();
  const title = `${event.teamName} ${getScheduleTitle(event)}`;
  const whenWhere = `${formatEventDateLabel(event.date)} ${formatEventTimeLabel(event.date)} · ${event.location || 'Location TBD'}`;
  const destinations: ScheduleHubDestination[] = [];

  if (liveStatus === 'completed') {
    destinations.push({
      id: 'watch-replay',
      title: 'Watch replay',
      detail: 'Replay, reactions, and clips',
      icon: 'video',
      url: getPublicReplayHref(event),
      actionLabel: 'Watch replay',
      shareLabel: 'Replay',
      shareTitle: `${title} replay`,
      shareText: `${title} replay · ${whenWhere}`,
      badge: 'Replay'
    });
  } else if (liveStatus === 'live') {
    destinations.push({
      id: 'watch-live',
      title: 'Watch live',
      detail: 'Live scoreboard, stream, and reactions',
      icon: 'radio',
      url: getPublicLiveHref(event),
      actionLabel: 'Watch live',
      shareLabel: 'Live game',
      shareTitle: `${title} live`,
      shareText: `${title} live · ${whenWhere}`,
      badge: 'Live'
    });
  }

  destinations.push({
    id: 'match-report',
    title: 'Match report',
    detail: 'Score, summary, stats, and play-by-play',
    icon: 'file-text',
    url: getPublicGameReportHref(event),
    actionLabel: 'Open report',
    shareLabel: 'Match report',
    shareTitle: `${title} match report`,
    shareText: `${title} match report · ${whenWhere}`
  });

  return destinations;
}

export function buildPracticeHubDestinations(event: ParentScheduleEvent): ScheduleHubDestination[] {
  const title = `${event.teamName} ${event.title || 'practice'}`;
  const details = getPracticeShareText(event);

  return [
    {
      id: 'practice-share',
      title: 'Share practice',
      detail: 'Send date, time, location, and packet notes',
      icon: 'share',
      actionLabel: 'Share practice',
      actionKind: 'share',
      shareLabel: 'Practice',
      shareTitle: title,
      shareText: details,
      shareUrl: null,
      hideShareButton: true
    },
    {
      id: 'practice-team',
      title: 'Team page',
      detail: 'Roster, schedule, registration, and team info',
      icon: 'users',
      url: getPublicTeamHref(event),
      actionLabel: 'Open team',
      shareLabel: 'Practice',
      shareTitle: title,
      shareText: details,
      shareUrl: null,
      hideShareButton: true
    }
  ];
}

export function getPracticeShareText(event: ParentScheduleEvent) {
  return [
    `${event.teamName} ${event.title || 'practice'}`,
    `${formatEventDateLabel(event.date)} ${formatEventTimeLabel(event.date)}`,
    event.location || 'Location TBD',
    event.arrivalTime ? `Arrive ${formatEventTimeLabel(event.arrivalTime)}` : '',
    event.practiceHomePacketSummary ? `Packet: ${event.practiceHomePacketSummary}` : '',
    event.notes || ''
  ].filter(Boolean).join(' · ');
}

export function getPublicGameReportHref(event: ParentScheduleEvent) {
  return getPublicHashHref('/game.html', { teamId: event.teamId, gameId: event.id });
}

export function getPublicLiveHref(event: ParentScheduleEvent) {
  return getPublicHref('/live-game.html', {
    teamId: event.teamId,
    gameId: event.id
  });
}

export function getPublicReplayHref(event: ParentScheduleEvent) {
  return getPublicHref('/live-game.html', {
    teamId: event.teamId,
    gameId: event.id,
    replay: 'true'
  });
}

export function getPublicTeamHref(event: ParentScheduleEvent) {
  return getPublicHashHref('/team.html', { teamId: event.teamId });
}

export function getPublicPlayerHref(teamId: string, gameId: string, playerId: string) {
  return getPublicHashHref('/player.html', { teamId, gameId, playerId });
}

export function getPublicPracticeHref(event: ParentScheduleEvent) {
  return getPublicHref('/drills.html', {
    teamId: event.teamId,
    eventId: event.id
  });
}

function getPublicOrigin() {
  return 'https://allplays.ai';
}

function getPublicHref(path: string, params: Record<string, string>, hash = '') {
  const url = new URL(path, getPublicOrigin());
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  if (hash) url.hash = hash;
  return url.toString();
}

function getPublicHashHref(path: string, params: Record<string, string>) {
  const url = new URL(path, getPublicOrigin());
  const hashParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) hashParams.set(key, value);
  });
  url.hash = hashParams.toString();
  return url.toString();
}
