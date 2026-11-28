import { describe, expect, it } from 'vitest';
import { assignmentPath, assignmentProgress, videoPreview } from './resourceAssignmentPresentation';
import type { PacketTask } from './resourcePacketsService';
describe('assignment presentation', () => {
  it('derives completion only from all deliberate opens, never self-reported watching', () => {
    const task = {
      items: [{ resourceId: 'a' }, { resourceId: 'b' }],
      signals: { a: { opened: { value: true } }, b: { watched: { value: true } } }
    } as unknown as PacketTask;
    expect(assignmentProgress(task)).toEqual({ opened: 1, practiced: 0, total: 2, legacy: true, complete: false });
    task.signals.b.opened = { value: true, at: 'now', actorUid: 'guardian' };
    expect(assignmentProgress(task).complete).toBe(true);
  });
  it('requires explicit practice acknowledgment for new assignments', () => {
    const task = {
      completionPolicy: 'practice_ack',
      items: [{ resourceId: 'a' }],
      signals: { a: { opened: { value: true }, practiced: { value: false } } }
    } as unknown as PacketTask;
    expect(assignmentProgress(task).complete).toBe(false);
    task.signals.a.practiced = { value: true, at: 'now', actorUid: 'guardian' };
    expect(assignmentProgress(task)).toMatchObject({ opened: 1, practiced: 1, legacy: false, complete: true });
  });
  it('uses only recognized YouTube IDs for a thumbnail; other HTTPS sites get an honest placeholder', () => {
    expect(videoPreview('https://youtu.be/abcdefghijk')?.thumbnail).toBe('https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
    expect(videoPreview('https://youtube.com.evil.test/watch?v=abcdefghijk')?.thumbnail).toBeNull();
    expect(videoPreview('javascript:alert(1)')).toBeNull();
  });
  it('builds assignment links with an explicit child context', () => {
    expect(assignmentPath('team', 'assignment', 'child')).toBe('/players/team/child/resources?assignmentId=assignment');
  });
});
