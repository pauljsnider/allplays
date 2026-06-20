import type { ParentHomeTeam } from './homeLogic';

export type TeamNavigationKind = 'native' | 'website';

export type TeamNavigationItem = {
  id: string;
  label: string;
  detail: string;
  href: string;
  kind: TeamNavigationKind;
  badge?: string;
};

export type TeamNavigationSection = {
  id: 'core' | 'resources' | 'management';
  title: string;
  detail: string;
  items: TeamNavigationItem[];
};

export function isTeamManagementRole(role = '') {
  return /\b(admin|coach|owner|staff|manager)\b/i.test(role);
}

export function buildTeamNavigation(team: ParentHomeTeam): TeamNavigationSection[] {
  const teamId = team.teamId;
  const canUseAppSchedule = team.eventCount > 0 || team.players.length > 0;
  const canManage = isTeamManagementRole(team.role);
  const playerItem = buildPlayerNavigationItem(team);
  const coreItems: TeamNavigationItem[] = [
    {
      id: 'team-page',
      label: 'Team page',
      detail: 'Team photo, roster, schedule, pass, standings, and player insights',
      href: `/teams/${encodeURIComponent(teamId)}`,
      kind: 'native'
    },
    ...(canUseAppSchedule ? [{
      id: 'schedule',
      label: 'Schedule',
      detail: 'Games, practices, availability, rides, and assignments',
      href: getTeamSchedulePath(teamId),
      kind: 'native' as const,
      badge: team.openActions > 0 ? `${team.openActions} action${team.openActions === 1 ? '' : 's'}` : undefined
    }] : []),
    {
      id: 'messages',
      label: 'Messages',
      detail: 'Team chat, staff threads, unread messages',
      href: `/messages/${encodeURIComponent(teamId)}`,
      kind: 'native',
      badge: team.unreadCount > 0 ? `${team.unreadCount} unread` : undefined
    },
    ...(canUseAppSchedule ? [{
      id: 'practice-packets',
      label: 'Practice packets',
      detail: 'Home drills, packet notes, and completion status',
      href: getTeamSchedulePath(teamId, { view: 'packets' }),
      kind: 'native' as const
    }] : [])
  ];

  const resources: TeamNavigationItem[] = [
    {
      id: 'website-team-page',
      label: 'Website team page',
      detail: 'Full current website view with roster, schedule, and public widgets',
      href: getTeamWebsiteHashHref('team.html', teamId),
      kind: 'website'
    },
    ...(playerItem ? [playerItem] : []),
    {
      id: 'media',
      label: 'Media',
      detail: 'Photos, video links, albums, and files',
      href: `/teams/${encodeURIComponent(teamId)}/media`,
      kind: 'native'
    },
    {
      id: 'parent-fees',
      label: 'My fees',
      detail: 'Parent balances, checkout links, installments, and payment history',
      href: '/parent-tools/fees',
      kind: 'native'
    },
    {
      id: 'registrations',
      label: 'Registrations',
      detail: 'Published team forms and public registration links',
      href: '/parent-tools/registrations',
      kind: 'native'
    },
    {
      id: 'awards',
      label: 'Awards',
      detail: 'Published certificates for linked players',
      href: '/parent-tools/certificates',
      kind: 'native'
    }
  ];

  const management: TeamNavigationItem[] = canManage ? [
    {
      id: 'team-settings',
      label: 'Team settings',
      detail: 'Sport, visibility, stream, registration, permissions',
      href: getTeamWebsiteHashHref('edit-team.html', teamId),
      kind: 'website'
    },
    {
      id: 'manage-roster',
      label: 'Manage roster',
      detail: 'Players, parent invites, custom fields, imports',
      href: getTeamWebsiteHashHref('edit-roster.html', teamId),
      kind: 'website'
    },
    {
      id: 'manage-schedule',
      label: 'Manage schedule',
      detail: 'Games, practices, reminders, cancellations',
      href: getTeamWebsiteHashHref('edit-schedule.html', teamId),
      kind: 'website'
    },
    {
      id: 'fees',
      label: 'Fees',
      detail: 'Record offline payments in the app; use the website for full fee setup',
      href: `/teams/${encodeURIComponent(teamId)}/fees`,
      kind: 'native'
    },
    {
      id: 'practice-command',
      label: 'Team drills',
      detail: 'Create, edit, and delete team custom drills',
      href: `/teams/${encodeURIComponent(teamId)}/drills`,
      kind: 'native'
    },
    {
      id: 'game-plan',
      label: 'Game plan',
      detail: 'Lineups, plans, autosave, handoff',
      href: getTeamWebsiteHashHref('game-plan.html', teamId),
      kind: 'website'
    },
    {
      id: 'game-day',
      label: 'Game day',
      detail: 'RSVP breakdown, lineup, live logs, wrap-up',
      href: getTeamWebsiteQueryHref('game-day.html', { teamId }),
      kind: 'website'
    },
    {
      id: 'tracking',
      label: 'Tracking',
      detail: 'Roster tracking statuses and stat controls',
      href: `/teams/${encodeURIComponent(teamId)}?tab=roster`,
      kind: 'native'
    },
    {
      id: 'stats-config',
      label: 'Stats config',
      detail: 'Tracker columns, sport presets, access checks',
      href: `/teams/${encodeURIComponent(teamId)}?tab=more`,
      kind: 'native'
    },
    {
      id: 'certificates',
      label: 'Certificates',
      detail: 'Create drafts and preview in the app, then finish publish and print on the website',
      href: `/teams/${encodeURIComponent(teamId)}/certificates`,
      kind: 'native'
    }
  ] : [];

  const sections: TeamNavigationSection[] = [
    {
      id: 'core',
      title: 'Use now',
      detail: canUseAppSchedule ? 'Fast app workflows for this team.' : 'Team communication is available in the app.',
      items: coreItems
    },
    {
      id: 'resources',
      title: 'Team resources',
      detail: 'Current website pages with the full team experience.',
      items: resources
    }
  ];

  if (management.length) {
    sections.push({
      id: 'management',
      title: 'Coach/admin tools',
      detail: 'Full operations stay on the current website until each feature is migrated.',
      items: management
    });
  }

  return sections.filter((section) => section.items.length > 0);
}

export function getTeamSchedulePath(teamId: string, options: { view?: string; filter?: string } = {}) {
  const params = new URLSearchParams();
  if (teamId) params.set('teamId', teamId);
  if (options.view) params.set('view', options.view);
  if (options.filter) params.set('filter', options.filter);
  const query = params.toString();
  return `/schedule${query ? `?${query}` : ''}`;
}

export function getTeamWebsiteHashHref(path: string, teamId: string, extra: Record<string, string> = {}) {
  const url = new URL(path, getPublicOrigin());
  const hashParams = new URLSearchParams();
  if (teamId) hashParams.set('teamId', teamId);
  Object.entries(extra).forEach(([key, value]) => {
    if (value) hashParams.set(key, value);
  });
  url.hash = hashParams.toString();
  return url.toString();
}

export function getTeamWebsiteQueryHref(path: string, params: Record<string, string>) {
  const url = new URL(path, getPublicOrigin());
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  return url.toString();
}

function buildPlayerNavigationItem(team: ParentHomeTeam): TeamNavigationItem | null {
  if (team.players.length === 1) {
    const player = team.players[0];
    return {
      id: 'player-profile',
      label: 'Player profile',
      detail: 'Reports, editable profile, incentives, clips',
      href: `/players/${encodeURIComponent(player.teamId)}/${encodeURIComponent(player.playerId)}`,
      kind: 'native'
    };
  }

  if (team.players.length > 1) {
    return {
      id: 'players',
      label: 'Players',
      detail: `${team.players.length} linked player profiles and reports`,
      href: getTeamWebsiteHashHref('team.html', team.teamId),
      kind: 'website'
    };
  }

  return null;
}

function getPublicOrigin() {
  return 'https://allplays.ai';
}
