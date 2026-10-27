import { isNativeRuntime } from './nativeRuntime';
import { openPublicUrl } from './publicActions';
import { toAppServiceError } from './appErrors';
import type { YouTubeMetadata } from './youtubeMetadata';

export type PacketCompletionPolicy = 'link_opened_legacy' | 'practice_ack';

export type PacketResource = { resourceId: string; version: number; title: string; teachingPoint: string; url: string; drillId?: string };
export type PacketItem = Omit<PacketResource, 'version'> & { resourceVersion: number };
export type PacketAssignment = {
  assignmentId: string;
  revision: number;
  publishedVersion: number;
  title: string;
  notes: string;
  items: PacketItem[];
  playerIds: string[];
  practiceId: string | null;
  dueAt: string | null;
  timeZone: string | null;
  completionPolicy?: PacketCompletionPolicy;
};
export type PacketSignal = { value: boolean; at: string; actorUid: string };
export type PacketTask = {
  teamId: string;
  assignmentId: string;
  version: number;
  playerId: string;
  playerName: string;
  title: string;
  notes: string;
  items: PacketItem[];
  dueAt: string | null;
  timeZone: string | null;
  completionPolicy?: PacketCompletionPolicy;
  signals: Record<string, Partial<Record<'opened' | 'watched' | 'practiced', PacketSignal>>>;
};
export type PacketStaffView = {
  teamName?: string;
  cursors: Record<string, string | null>;
  practices: { id: string; title: string }[];
  resources: PacketResource[];
  assignments: PacketAssignment[];
  tasks: PacketTask[];
  players: { id: string; name: string }[];
  deliveries: { deliveryId: string; assignmentId: string; version: number; state: string }[];
};
const pending = new Map<string, string>();
export const resourcePacketsAvailable = () => import.meta.env.VITE_RESOURCE_PACKETS_ENABLED === 'true';
export function packetDueDate(value: string) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) !== value)
    throw new Error('Choose a valid local date and time. This time may fall in a daylight-saving gap.');
  return date.toISOString();
}

async function invoke(name: string, data: Record<string, unknown>) {
  if (!resourcePacketsAvailable()) throw new Error('Resource packets are not enabled for this web app.');
  try {
    const { resourcePacketCall } = await import('./adapters/resourcePacketsFirebase');
    return await resourcePacketCall(name, data);
  } catch (error) {
    throw toAppServiceError(error, 'Unable to load or save practice packets. Try again.');
  }
}
export async function loadResourcePacketStaff(teamId: string, cursors?: Record<string, string | null>): Promise<PacketStaffView> {
  return (await invoke('resourcePacketsQuery', { teamId, view: 'staff', ...(cursors ? { cursors } : {}) })) as PacketStaffView;
}
export async function loadResourcePacketYouTubeMetadata(teamId: string, url: string): Promise<YouTubeMetadata> {
  return (await invoke('resourcePacketsQuery', { teamId, view: 'youtubeMetadata', url })) as YouTubeMetadata;
}
export async function loadResourcePacketFamily(
  teamId: string,
  playerId: string,
  cursor?: string,
  assignmentId?: string
): Promise<{ tasks: PacketTask[]; cursors: { tasks: string | null } }> {
  return (await invoke('resourcePacketsQuery', {
    teamId,
    playerId,
    view: 'family',
    ...(assignmentId ? { assignmentId } : {}),
    ...(cursor ? { cursors: { tasks: cursor } } : {})
  })) as { tasks: PacketTask[]; cursors: { tasks: string | null } };
}
/** Keep a failed request's identity for explicit retry; never auto-send offline. */
export async function resourcePacketCommand(uid: string, data: Record<string, unknown>): Promise<unknown> {
  const key = JSON.stringify([uid, data]);
  const requestId = typeof data.requestId === 'string' ? data.requestId : pending.get(key) || crypto.randomUUID();
  pending.set(key, requestId);
  const result = await invoke('resourcePacketsCommand', { ...data, requestId });
  pending.delete(key);
  return result;
}
export async function openResourcePacketLink(uid: string, task: PacketTask, item: PacketItem) {
  if (isNativeRuntime()) {
    const result = (await resourcePacketCommand(uid, {
      teamId: task.teamId,
      action: 'report',
      assignmentId: task.assignmentId,
      version: task.version,
      playerId: task.playerId,
      resourceId: item.resourceId,
      kind: 'opened'
    })) as { url: string };
    const url = new URL(result.url);
    if (url.protocol !== 'https:') throw new Error('This link is unavailable.');
    await openPublicUrl(url.href);
    return;
  }
  // No href, preload, hover or AI read calls this function. Reserve a new tab
  // during the deliberate gesture, before the authenticated command resolves.
  const tab = window.open('about:blank', '_blank');
  if (!tab) throw new Error('Allow this link to open in a new tab, then try again.');
  tab.opener = null;
  try {
    const result = (await resourcePacketCommand(uid, {
      teamId: task.teamId,
      action: 'report',
      assignmentId: task.assignmentId,
      version: task.version,
      playerId: task.playerId,
      resourceId: item.resourceId,
      kind: 'opened'
    })) as { url: string };
    const url = new URL(result.url);
    if (url.protocol !== 'https:') throw new Error('This link is unavailable.');
    tab.location.replace(url.href);
  } catch (error) {
    tab.close();
    throw error;
  }
}

export async function loadResourcePacketLinkedPlayers(): Promise<{
  players: { teamId: string; playerId: string; teamName: string; playerName: string }[];
}> {
  return (await invoke('resourcePacketsQuery', { view: 'linkedPlayers' })) as {
    players: { teamId: string; playerId: string; teamName: string; playerName: string }[];
  };
}

export type PacketHomeTask = PacketTask & { teamName: string };

/** Load the complete linked-family task set without fanning requests out in parallel. */
export async function loadResourcePacketHomeTasks(): Promise<PacketHomeTask[]> {
  const { players } = await loadResourcePacketLinkedPlayers();
  const tasks: PacketHomeTask[] = [];
  for (const player of players) {
    let cursor: string | undefined;
    let pages = 0;
    do {
      if (++pages > 100) throw new Error('Unable to load the complete practice list.');
      const page = await loadResourcePacketFamily(player.teamId, player.playerId, cursor);
      tasks.push(...page.tasks.map((task) => ({ ...task, teamName: player.teamName })));
      cursor = page.cursors.tasks || undefined;
    } while (cursor);
  }
  return tasks;
}
