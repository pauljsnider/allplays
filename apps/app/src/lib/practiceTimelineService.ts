import { getDrills, getPracticeSessionByEvent, getTeam, getTeamDrills, updatePracticeSession, upsertPracticeSessionForEvent } from '../../../../js/db.js';
import { appendLivePracticeNote } from '../../../../js/drills-live-practice-notes.js';
import { hasFullTeamAccess } from '../../../../js/team-access.js';
import type { AuthUser } from './types';

export type PracticeTimelineNote = {
  type: string;
  text: string;
  createdAt: string;
};

export type PracticeTimelineBlock = {
  order: number;
  drillId: string | null;
  drillTitle: string;
  type: string;
  duration: number;
  description: string;
  notes: string;
  notesLog: PracticeTimelineNote[];
};

export type PracticeTimelineDrillOption = {
  id: string;
  title: string;
  type: string;
  duration: number;
  description: string;
  source: 'community' | 'team';
};

export type PracticeTimelineModel = {
  sessionId: string | null;
  teamId: string;
  eventId: string;
  teamName: string;
  teamSport: string;
  blocks: PracticeTimelineBlock[];
  drillOptions: PracticeTimelineDrillOption[];
};

type SavePracticeTimelineInput = {
  teamId: string;
  eventId: string;
  user: AuthUser | null;
  sessionId?: string | null;
  blocks: PracticeTimelineBlock[];
  date?: Date | null;
  location?: string | null;
  title?: string | null;
};

function normalizeString(value: unknown) {
  return String(value || '').trim();
}

function normalizeDuration(value: unknown, fallback = 10) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, parsed);
}

function normalizeNotesLog(value: unknown): PracticeTimelineNote[] {
  return (Array.isArray(value) ? value : [])
    .map((entry) => ({
      type: normalizeString((entry as any)?.type) || 'text',
      text: normalizeString((entry as any)?.text),
      createdAt: normalizeString((entry as any)?.createdAt) || new Date().toISOString()
    }))
    .filter((entry) => entry.text);
}

export function normalizePracticeTimelineBlock(block: any, index = 0): PracticeTimelineBlock {
  return {
    order: Math.max(0, Number.parseInt(String(block?.order ?? index), 10) || index),
    drillId: normalizeString(block?.drillId) || null,
    drillTitle: normalizeString(block?.drillTitle || block?.title) || `Drill ${index + 1}`,
    type: normalizeString(block?.type) || 'Technical',
    duration: normalizeDuration(block?.duration, normalizeDuration(block?.setup?.duration, 10)),
    description: normalizeString(block?.description),
    notes: normalizeString(block?.notes),
    notesLog: normalizeNotesLog(block?.notesLog)
  };
}

export function createPracticeTimelineBlockFromOption(option: PracticeTimelineDrillOption, index: number): PracticeTimelineBlock {
  return normalizePracticeTimelineBlock({
    order: index,
    drillId: option.id,
    drillTitle: option.title,
    type: option.type,
    duration: option.duration,
    description: option.description,
    notes: '',
    notesLog: []
  }, index);
}

export function getPracticeTimelineTotalMinutes(blocks: PracticeTimelineBlock[]) {
  return (Array.isArray(blocks) ? blocks : []).reduce((sum, block) => sum + normalizeDuration(block?.duration, 0), 0);
}

function toDrillOption(drill: any, source: 'community' | 'team'): PracticeTimelineDrillOption | null {
  const id = normalizeString(drill?.id);
  if (!id) return null;
  return {
    id,
    title: normalizeString(drill?.title) || 'Untitled drill',
    type: normalizeString(drill?.type) || 'Technical',
    duration: normalizeDuration(drill?.setup?.duration, 10),
    description: normalizeString(drill?.description),
    source
  };
}

async function assertPracticeTimelineAccess(teamId: string, user: AuthUser | null) {
  if (!teamId) throw new Error('Missing team context.');
  const team = await Promise.resolve(getTeam(teamId));
  if (!team?.id) throw new Error('Team not found.');
  if (!hasFullTeamAccess(user, team)) {
    throw new Error('Only team owners and admins can manage practice timelines.');
  }
  return team;
}

export async function loadPracticeTimelineModel(teamId: string, eventId: string, user: AuthUser | null): Promise<PracticeTimelineModel> {
  if (!eventId) throw new Error('Missing practice event context.');
  const team = await assertPracticeTimelineAccess(teamId, user);
  const teamSport = normalizeString(team?.sport) || 'Soccer';
  const [session, communityDrills, teamDrills] = await Promise.all([
    Promise.resolve(getPracticeSessionByEvent(teamId, eventId)),
    Promise.resolve(getDrills({ sport: teamSport })),
    Promise.resolve(getTeamDrills(teamId))
  ]);

  const blocks = (Array.isArray(session?.blocks) ? session.blocks : [])
    .slice()
    .sort((left, right) => (Number(left?.order) || 0) - (Number(right?.order) || 0))
    .map((block, index) => normalizePracticeTimelineBlock(block, index));

  const drillOptions = [
    ...(Array.isArray(communityDrills) ? communityDrills : []).map((drill) => toDrillOption(drill, 'community')),
    ...(Array.isArray(teamDrills) ? teamDrills : []).map((drill) => toDrillOption(drill, 'team'))
  ].filter(Boolean) as PracticeTimelineDrillOption[];

  return {
    sessionId: normalizeString(session?.id) || null,
    teamId,
    eventId,
    teamName: normalizeString(team?.name) || 'Team',
    teamSport,
    blocks,
    drillOptions
  };
}

export async function savePracticeTimelineForApp(input: SavePracticeTimelineInput) {
  const team = await assertPracticeTimelineAccess(input.teamId, input.user);
  const normalizedBlocks = (Array.isArray(input.blocks) ? input.blocks : []).map((block, index) => ({
    ...normalizePracticeTimelineBlock(block, index),
    order: index
  }));
  const payload = {
    eventId: input.eventId,
    eventType: 'practice',
    sourcePage: 'app',
    title: normalizeString(input.title) || null,
    location: normalizeString(input.location) || null,
    date: input.date || null,
    duration: getPracticeTimelineTotalMinutes(normalizedBlocks),
    blocks: normalizedBlocks
  };

  const sessionId = normalizeString(input.sessionId);
  if (sessionId) {
    await Promise.resolve(updatePracticeSession(input.teamId, sessionId, payload));
    return sessionId;
  }

  return Promise.resolve(upsertPracticeSessionForEvent(input.teamId, input.eventId, {
    ...payload,
    title: payload.title || normalizeString(team?.name) || 'Practice'
  }));
}

export async function appendPracticeTimelineLiveNoteForApp(input: SavePracticeTimelineInput & {
  blockIndex: number;
  text: string;
  type?: string;
}) {
  const blocks = (Array.isArray(input.blocks) ? input.blocks : []).map((block, index) => normalizePracticeTimelineBlock(block, index));
  const block = blocks[input.blockIndex];
  if (!block) throw new Error('Select a drill before saving a live note.');
  if (!appendLivePracticeNote(block as any, input.text, input.type || 'text')) {
    throw new Error('Enter a note before saving.');
  }
  const nextBlocks = blocks.map((candidate, index) => ({ ...candidate, order: index }));
  const sessionId = await savePracticeTimelineForApp({ ...input, blocks: nextBlocks });
  return {
    sessionId,
    blocks: nextBlocks
  };
}
