import { describe, expect, it } from 'vitest';
import { reconcileAssignment, type AssignmentComposition } from './assignmentConflict';
const base: AssignmentComposition = {
  title: 'Title',
  notes: 'Note',
  items: [{ resourceId: 'r', version: 1, title: 'Video', url: 'https://example.com/a', teachingPoint: '' }],
  players: ['a', 'b'],
  due: '',
  practiceId: ''
};
describe('assignment reconciliation', () => {
  it('preserves independent local edits and adopts server changes, including pinned media', () => {
    const latest = { ...base, items: [{ ...base.items[0], version: 2, url: 'https://example.com/b' }], players: ['b'] };
    const result = reconcileAssignment(base, { ...base, notes: 'My note' }, latest);
    expect(result.conflicts).toEqual([]);
    expect(result.merged).toEqual({ ...latest, notes: 'My note' });
  });
  it('requires explicit resolution of media, audience, date and practice conflicts', () => {
    const mine = {
      ...base,
      items: [{ ...base.items[0], url: 'https://example.com/mine' }],
      players: ['a'],
      due: '2026-11-01T12:00',
      practiceId: 'p1'
    };
    const latest = { ...base, items: [{ ...base.items[0], version: 2 }], players: ['b'], due: '2026-11-02T12:00', practiceId: 'p2' };
    expect(reconcileAssignment(base, mine, latest).conflicts).toEqual(['items', 'players', 'due', 'practiceId']);
  });
  it('does not conflict on identical edits or reordered audiences', () => {
    const latest = { ...base, notes: 'Same note', players: ['b', 'a'] };
    expect(reconcileAssignment(base, { ...base, notes: 'Same note' }, latest).conflicts).toEqual([]);
  });
});
