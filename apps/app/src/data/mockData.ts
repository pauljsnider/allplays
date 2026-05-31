import type { AuthUser, Game, MessagePreview, Player, Team } from '../lib/types';

export const mockUser: AuthUser = {
  uid: 'mock-parent-1',
  email: 'paul@example.com',
  displayName: 'Paul Snider',
  roles: ['parent']
};

export const mockPlayers: Player[] = [
  {
    id: 'player-1',
    name: 'Kevin',
    teamId: 'team-bears',
    teamName: 'Bears',
    number: '9',
    role: 'athlete'
  },
  {
    id: 'player-2',
    name: 'Paul',
    teamId: 'team-bears',
    teamName: 'Bears',
    number: '12',
    role: 'athlete'
  },
  {
    id: 'player-3',
    name: 'Player 1',
    teamId: 'team-aaa',
    teamName: 'AAA - Bball',
    number: '4',
    role: 'athlete'
  }
];

export const mockTeams: Team[] = [
  {
    id: 'team-bears',
    name: 'Bears',
    sport: 'Basketball',
    role: 'Parent',
    record: '8-3',
    rosterSize: 11,
    nextGameId: 'game-1',
    unreadCount: 3
  },
  {
    id: 'team-aaa',
    name: 'AAA - Bball',
    sport: 'Basketball',
    role: 'Admin',
    record: '5-2',
    rosterSize: 9,
    nextGameId: 'game-2',
    unreadCount: 0
  },
  {
    id: 'team-thunder',
    name: 'Thunder',
    sport: 'Soccer',
    role: 'Coach',
    record: '6-4-1',
    rosterSize: 16,
    nextGameId: 'game-3',
    unreadCount: 8
  }
];

export const mockGames: Game[] = [
  {
    id: 'game-1',
    teamId: 'team-bears',
    teamName: 'Bears',
    opponent: 'Falcons',
    type: 'game',
    dateLabel: 'Sat, May 23',
    timeLabel: '10:30 AM',
    location: 'North Gym Court 2',
    playerIds: ['player-1', 'player-2'],
    availability: 'needed',
    rideshare: { seatsLeft: 2, requests: 1 },
    assignments: ['Snacks: Open', 'Scorebook: Jamie'],
    status: 'live',
    liveEvents: [
      { id: 'game-1-event-1', type: 'score', period: 'Q1', gameClockMs: 320000, description: '#9 Kevin scored 2 points' },
      { id: 'game-1-event-2', type: 'rebound', period: 'Q1', gameClockMs: 301000, description: '#12 Paul defensive rebound' }
    ]
  },
  {
    id: 'practice-1',
    teamId: 'team-bears',
    teamName: 'Bears',
    opponent: 'Practice',
    type: 'practice',
    dateLabel: 'Tue, May 26',
    timeLabel: '6:00 PM',
    location: 'Community Center',
    playerIds: ['player-1', 'player-2'],
    availability: 'going',
    rideshare: { seatsLeft: 0, requests: 0 },
    assignments: ['Home packet ready'],
    status: 'upcoming'
  },
  {
    id: 'game-2',
    teamId: 'team-aaa',
    teamName: 'AAA - Bball',
    opponent: 'Rockets',
    type: 'game',
    dateLabel: 'Thu, May 28',
    timeLabel: '7:15 PM',
    location: 'East High',
    playerIds: ['player-3'],
    availability: 'maybe',
    rideshare: { seatsLeft: 4, requests: 0 },
    assignments: ['Clock: Assigned', 'Video: Open'],
    status: 'upcoming'
  }
];

export const mockMessages: MessagePreview[] = [
  {
    teamId: 'team-bears',
    teamName: 'Bears',
    lastMessage: 'Practice packet is posted for Tuesday.',
    senderName: 'Coach Jamie',
    timeLabel: '8:12 AM',
    unreadCount: 3
  },
  {
    teamId: 'team-aaa',
    teamName: 'AAA - Bball',
    lastMessage: 'Who can help with scorebook this week?',
    senderName: 'Morgan',
    timeLabel: 'Yesterday',
    unreadCount: 0
  },
  {
    teamId: 'team-thunder',
    teamName: 'Thunder',
    lastMessage: 'Tournament schedule changed.',
    senderName: 'ALL PLAYS',
    timeLabel: 'Mon',
    unreadCount: 8
  }
];
