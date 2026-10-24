import type { PacketTask } from './resourcePacketsService';

export function assignmentProgress(task: Pick<PacketTask, 'items' | 'signals'>) {
  const opened = task.items.filter((item) => task.signals[item.resourceId]?.opened?.value === true).length;
  return { opened, total: task.items.length, complete: task.items.length > 0 && opened === task.items.length };
}

export function videoPreview(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    const id =
      host === 'youtu.be'
        ? parsed.pathname.slice(1)
        : ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)
          ? parsed.searchParams.get('v') || parsed.pathname.match(/^\/(?:shorts|embed)\/([^/]+)$/)?.[1]
          : '';
    return { host, thumbnail: id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null };
  } catch {
    return null;
  }
}

export function assignmentPath(teamId: string, assignmentId: string, playerId?: string) {
  const query = new URLSearchParams({ assignmentId, ...(playerId ? {} : { teamId }) });
  return `${playerId ? `/players/${encodeURIComponent(teamId)}/${encodeURIComponent(playerId)}/resources` : '/practice-resources'}?${query}`;
}

export function assignmentAiPath(teamId: string, prompt: string) {
  return `/ai?${new URLSearchParams({ newChat: '1', teamId, prompt })}`;
}
