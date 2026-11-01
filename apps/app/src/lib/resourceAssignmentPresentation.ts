import type { PacketTask } from './resourcePacketsService';
import type { ParentHomeAction } from './homeLogic';

export function assignmentProgress(task: Pick<PacketTask, 'items' | 'signals' | 'completionPolicy'>) {
  const opened = task.items.filter((item) => task.signals[item.resourceId]?.opened?.value === true).length;
  const practiced = task.items.filter((item) => task.signals[item.resourceId]?.practiced?.value === true).length;
  const legacy = task.completionPolicy !== 'practice_ack';
  const completedItems = legacy ? opened : practiced;
  return { opened, practiced, total: task.items.length, legacy, complete: task.items.length > 0 && completedItems === task.items.length };
}

export function practiceHomeActions(tasks: Array<PacketTask & { teamName?: string }>, now = new Date()): ParentHomeAction[] {
  return tasks
    .filter((task) => !assignmentProgress(task).complete)
    .map((task) => {
      const due = task.dueAt ? new Date(task.dueAt) : null;
      const overdue = due && due.getTime() < now.getTime();
      const progress = assignmentProgress(task);
      const remaining = progress.total - (progress.legacy ? progress.opened : progress.practiced);
      return {
        id: `practice:${task.teamId}:${task.playerId}:${task.assignmentId}`,
        kind: 'practice' as const,
        tone: overdue ? 'rose' as const : 'blue' as const,
        title: `Practice with ${task.playerName}`,
        detail: `${task.title} · ${remaining} ${progress.legacy ? 'link' : 'practice item'}${remaining === 1 ? '' : 's'} left${task.teamName ? ` · ${task.teamName}` : ''}`,
        to: assignmentPath(task.teamId, task.assignmentId, task.playerId),
        priority: overdue ? 18 : 28,
        date: due
      };
    })
    .sort((left, right) => left.priority - right.priority || Number(left.date || Infinity) - Number(right.date || Infinity));
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
