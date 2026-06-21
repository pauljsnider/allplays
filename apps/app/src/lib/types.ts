import type { LucideIcon } from 'lucide-react';

export type UserRole = 'parent' | 'coach' | 'admin' | 'platformAdmin';

export type CapabilityCategory =
  | 'Entry'
  | 'Auth'
  | 'Account'
  | 'Parent'
  | 'Teams'
  | 'Schedule'
  | 'Communication'
  | 'Admin'
  | 'Roster'
  | 'Fees'
  | 'Media'
  | 'Registration'
  | 'Game Day'
  | 'Tracking'
  | 'Reports'
  | 'Player'
  | 'Awards'
  | 'Public'
  | 'Help'
  | 'Workflow'
  | 'Mobile'
  | 'Beta'
  | 'Test';

export type MigrationStatus = 'native-shell' | 'stub' | 'legacy-link' | 'future';

export interface Capability {
  id: string;
  title: string;
  legacyPath: string;
  category: CapabilityCategory;
  roles: UserRole[];
  route: string;
  status: MigrationStatus;
  summary: string;
  features: string[];
}

export interface AuthUser {
  uid: string;
  email: string;
  displayName: string;
  photoUrl?: string;
  emailVerified?: boolean;
  roles: UserRole[];
  parentOf?: Array<Record<string, unknown>>;
  parentTeamIds?: string[];
  parentPlayerKeys?: string[];
  coachOf?: string[];
  isAdmin?: boolean;
  isPlatformAdmin?: boolean;
  teamMediaUploadTeamIds?: string[];
  mediaUploadTeamIds?: string[];
}

export interface AuthState {
  user: AuthUser | null;
  profile: Record<string, unknown> | null;
  loading: boolean;
  error: string | null;
  roles: UserRole[];
  isParent: boolean;
  isCoach: boolean;
  isAdmin: boolean;
  isPlatformAdmin: boolean;
  refresh: () => Promise<AuthUser | null>;
  signOut: () => Promise<void>;
}

export interface Player {
  id: string;
  name: string;
  teamId: string;
  teamName: string;
  number?: string;
  photoUrl?: string;
  role: 'athlete';
}

export interface Team {
  id: string;
  name: string;
  sport: string;
  role: 'Parent' | 'Coach' | 'Admin';
  record: string;
  rosterSize: number;
  nextGameId: string;
  unreadCount: number;
}

export interface Game {
  id: string;
  teamId: string;
  teamName: string;
  opponent: string;
  type: 'game' | 'practice';
  dateLabel: string;
  timeLabel: string;
  location: string;
  playerIds: string[];
  availability: 'going' | 'maybe' | 'not_going' | 'needed';
  rideshare: {
    seatsLeft: number;
    requests: number;
  };
  assignments: string[];
  status: 'upcoming' | 'past' | 'live';
  date?: Date | string;
  liveStatus?: string;
  liveEvents?: LiveGameEvent[];
}

export interface LiveGameEvent {
  id: string;
  type?: string;
  period?: string;
  gameClockMs?: number;
  description: string;
  createdAt?: number | string;
}

export interface MessagePreview {
  teamId: string;
  teamName: string;
  lastMessage: string;
  senderName: string;
  timeLabel: string;
  unreadCount: number;
}

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
}
