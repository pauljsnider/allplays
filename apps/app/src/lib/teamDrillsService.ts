import { createDrill, deleteDrill, getTeam, getTeamDrills, updateDrill, uploadDrillDiagram } from '../../../../js/db.js';
import { DRILL_LEVELS, DRILL_TYPES } from '../../../../js/drill-constants.js';
import { hasFullTeamAccess } from '../../../../js/team-access.js';
import type { AuthUser } from './types';

export type TeamDrillSummary = {
  id: string;
  title: string;
  sport: string;
  type: string;
  level: string;
  skills: string[];
  description: string;
  instructions: string;
  youtubeUrl: string;
  publishedToCommunity: boolean;
  diagramUrls: string[];
  setup: {
    duration: number;
    players: string;
    cones: number;
  };
};

export type TeamDrillsModel = {
  team: {
    id: string;
    name: string;
    sport: string;
  };
  canManageDrills: boolean;
  drills: TeamDrillSummary[];
};

export type TeamDrillFormInput = {
  id?: string;
  title: string;
  type: string;
  level: string;
  skills: string;
  duration: string | number;
  players: string;
  cones: string | number;
  description: string;
  instructions: string;
  youtubeUrl: string;
  publishedToCommunity: boolean;
  existingDiagramUrls?: string[];
  diagramFiles?: File[];
};

function normalizeString(value: unknown) {
  return String(value || '').trim();
}

function normalizeWholeNumber(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function normalizeSkills(value: unknown) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return Array.from(new Set(raw.map((skill) => String(skill || '').trim()).filter(Boolean)));
}

export function buildTeamDrillPayload(input: TeamDrillFormInput, sport: string) {
  const type = DRILL_TYPES.includes(input.type) ? input.type : 'Technical';
  const level = DRILL_LEVELS.includes(input.level) ? input.level : 'All';

  return {
    title: normalizeString(input.title),
    sport: normalizeString(sport) || 'Soccer',
    type,
    level,
    skills: normalizeSkills(input.skills),
    description: normalizeString(input.description),
    instructions: normalizeString(input.instructions),
    publishedToCommunity: Boolean(input.publishedToCommunity),
    youtubeUrl: normalizeString(input.youtubeUrl) || null,
    setup: {
      duration: Math.max(1, normalizeWholeNumber(input.duration, 15)),
      players: normalizeString(input.players),
      cones: Math.max(0, normalizeWholeNumber(input.cones, 0))
    }
  };
}

export async function loadTeamDrillsManagementModel(teamId: string, user: AuthUser | null): Promise<TeamDrillsModel> {
  if (!teamId) throw new Error('Missing team context.');

  const team = await Promise.resolve(getTeam(teamId));
  if (!team?.id) throw new Error('Team not found.');

  const canManageDrills = hasFullTeamAccess(user, team);
  if (!canManageDrills) {
    return {
      team: {
        id: team.id,
        name: normalizeString(team.name) || 'Team',
        sport: normalizeString(team.sport) || 'Soccer'
      },
      canManageDrills: false,
      drills: []
    };
  }

  const drills = await Promise.resolve(getTeamDrills(teamId));

  return {
    team: {
      id: team.id,
      name: normalizeString(team.name) || 'Team',
      sport: normalizeString(team.sport) || 'Soccer'
    },
    canManageDrills: true,
    drills: (Array.isArray(drills) ? drills : []).map(toTeamDrillSummary)
  };
}

export async function saveTeamDrillForApp(teamId: string, user: AuthUser | null, teamSport: string, input: TeamDrillFormInput) {
  if (!teamId) throw new Error('Missing team context.');
  const team = await Promise.resolve(getTeam(teamId));
  if (!hasFullTeamAccess(user, team)) throw new Error('You do not have access to manage team drills.');

  const payload = buildTeamDrillPayload(input, teamSport || team?.sport || 'Soccer');
  const existingDiagramUrls = Array.isArray(input.existingDiagramUrls) ? input.existingDiagramUrls.filter(Boolean) : [];
  const diagramFiles = Array.isArray(input.diagramFiles) ? input.diagramFiles.slice(0, Math.max(0, 5 - existingDiagramUrls.length)) : [];

  let drillId = normalizeString(input.id);
  if (drillId) {
    await Promise.resolve(updateDrill(drillId, payload));
  } else {
    drillId = await Promise.resolve(createDrill(teamId, payload));
  }

  if (diagramFiles.length || input.existingDiagramUrls) {
    const uploadedDiagramUrls: string[] = [];
    for (const file of diagramFiles) {
      uploadedDiagramUrls.push(await Promise.resolve(uploadDrillDiagram(teamId, drillId, file)));
    }
    await Promise.resolve(updateDrill(drillId, {
      diagramUrls: [...existingDiagramUrls, ...uploadedDiagramUrls]
    }));
  }

  return drillId;
}

export async function deleteTeamDrillForApp(teamId: string, user: AuthUser | null, drillId: string) {
  if (!teamId || !normalizeString(drillId)) throw new Error('Missing drill context.');
  const team = await Promise.resolve(getTeam(teamId));
  if (!hasFullTeamAccess(user, team)) throw new Error('You do not have access to manage team drills.');
  await Promise.resolve(deleteDrill(drillId));
}

function toTeamDrillSummary(drill: any): TeamDrillSummary {
  return {
    id: normalizeString(drill?.id),
    title: normalizeString(drill?.title) || 'Untitled drill',
    sport: normalizeString(drill?.sport) || 'Soccer',
    type: normalizeString(drill?.type) || 'Technical',
    level: normalizeString(drill?.level) || 'All',
    skills: normalizeSkills(drill?.skills),
    description: normalizeString(drill?.description),
    instructions: normalizeString(drill?.instructions),
    youtubeUrl: normalizeString(drill?.youtubeUrl),
    publishedToCommunity: Boolean(drill?.publishedToCommunity),
    diagramUrls: Array.isArray(drill?.diagramUrls) ? drill.diagramUrls.filter(Boolean).map((url: unknown) => String(url)) : [],
    setup: {
      duration: Math.max(1, normalizeWholeNumber(drill?.setup?.duration, 15)),
      players: normalizeString(drill?.setup?.players),
      cones: Math.max(0, normalizeWholeNumber(drill?.setup?.cones, 0))
    }
  };
}
