import type { PacketAssignment, PacketResource } from './resourcePacketsService';

export type AssignmentComposition = {
  title: string;
  notes: string;
  items: PacketResource[];
  players: string[];
  due: string;
  practiceId: string;
};
export const compositionLabels = {
  title: 'Assignment title',
  notes: 'Coaching note',
  items: 'Videos',
  players: 'Selected players',
  due: 'Due date',
  practiceId: 'Practice'
} satisfies Record<keyof AssignmentComposition, string>;
export function assignmentComposition(row: PacketAssignment): AssignmentComposition {
  const date = row.dueAt ? new Date(row.dueAt) : null;
  return {
    title: row.title || '',
    notes: row.notes || '',
    items: row.items.map(({ resourceVersion, ...item }) => ({ ...item, version: resourceVersion })),
    players: row.playerIds || [],
    practiceId: row.practiceId || '',
    due: date ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''
  };
}
function equal(key: keyof AssignmentComposition, a: unknown, b: unknown) {
  // Audience order is not meaningful. Video order and pinned versions are.
  return (
    JSON.stringify(key === 'players' ? [...(a as string[])].sort() : a) ===
    JSON.stringify(key === 'players' ? [...(b as string[])].sort() : b)
  );
}
export function reconcileAssignment(base: AssignmentComposition, mine: AssignmentComposition, latest: AssignmentComposition) {
  const merged = { ...mine };
  const conflicts: (keyof AssignmentComposition)[] = [];
  for (const key of Object.keys(compositionLabels) as (keyof AssignmentComposition)[]) {
    if (equal(key, mine[key], base[key])) Object.assign(merged, { [key]: latest[key] });
    else if (!equal(key, latest[key], base[key]) && !equal(key, mine[key], latest[key])) conflicts.push(key);
  }
  return { merged, conflicts };
}
