const { test, expect } = require('@playwright/test');

async function callWorkflow(page, fnName, args) {
  return page.evaluate(
    async ({ fnNameArg, argsArg }) => {
      const mod = await import('/js/practice-parent-workflow.js');
      return mod[fnNameArg](...argsArg);
    },
    { fnNameArg: fnName, argsArg: args }
  );
}

// @critical
test.describe('Practice + parent workflow suite @critical', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('hasRecordedAttendance returns false when players are missing', async ({ page }) => {
    const result = await callWorkflow(page, 'hasRecordedAttendance', [{}]);
    expect(result).toBe(false);
  });

  test('hasRecordedAttendance returns true when editedAt exists', async ({ page }) => {
    const result = await callWorkflow(page, 'hasRecordedAttendance', [
      { editedAt: '2026-02-21T00:00:00.000Z', players: [{ status: 'present' }] }
    ]);
    expect(result).toBe(true);
  });

  test('hasRecordedAttendance returns true when checked-in count is below roster size', async ({ page }) => {
    const result = await callWorkflow(page, 'hasRecordedAttendance', [
      { checkedInCount: 1, players: [{ status: 'present' }, { status: 'present' }] }
    ]);
    expect(result).toBe(true);
  });

  test('hasRecordedAttendance returns true when any player has a non-present status', async ({ page }) => {
    const result = await callWorkflow(page, 'hasRecordedAttendance', [
      { players: [{ status: 'present' }, { status: 'absent' }] }
    ]);
    expect(result).toBe(true);
  });

  test('hasRecordedAttendance returns false for all-present attendance with no edits', async ({ page }) => {
    const result = await callWorkflow(page, 'hasRecordedAttendance', [
      { checkedInCount: 2, players: [{ status: 'present' }, { status: 'present' }] }
    ]);
    expect(result).toBe(false);
  });

  test('hasHomePacket requires generated flag and at least one block', async ({ page }) => {
    const yes = await callWorkflow(page, 'hasHomePacket', [
      { homePacketGenerated: true, homePacketContent: { blocks: [{ title: 'Drill 1' }] } }
    ]);
    const no = await callWorkflow(page, 'hasHomePacket', [
      { homePacketGenerated: false, homePacketContent: { blocks: [{ title: 'Drill 1' }] } }
    ]);
    expect(yes).toBe(true);
    expect(no).toBe(false);
  });

  test('getHomePacketMinutes prefers totalMinutes when present', async ({ page }) => {
    const result = await callWorkflow(page, 'getHomePacketMinutes', [
      { totalMinutes: 37, blocks: [{ duration: 10 }, { duration: 20 }] }
    ]);
    expect(result).toBe(37);
  });

  test('getHomePacketMinutes sums block durations when totalMinutes is missing', async ({ page }) => {
    const result = await callWorkflow(page, 'getHomePacketMinutes', [
      { blocks: [{ duration: '10' }, { duration: 12 }, { duration: 'x' }] }
    ]);
    expect(result).toBe(22);
  });

  test('getAttendanceBreakdown returns counts for practice attendance tiles', async ({ page }) => {
    const result = await callWorkflow(page, 'getAttendanceBreakdown', [
      {
        checkedInCount: 2,
        players: [
          { status: 'present' },
          { status: 'late' },
          { status: 'absent' }
        ]
      }
    ]);

    expect(result).toEqual({
      recorded: true,
      rosterSize: 3,
      presentLikeCount: 2,
      lateCount: 1,
      absentCount: 1
    });
  });

  test('getCompletedChildIds and countCompletedChildren ignore non-completed records', async ({ page }) => {
    const completedIds = await page.evaluate(async () => {
      const mod = await import('/js/practice-parent-workflow.js');
      return Array.from(mod.getCompletedChildIds([
        { childId: 'p1', status: 'completed' },
        { childId: 'p2', status: 'in_progress' },
        { childId: 'p3', status: 'completed' }
      ]));
    });
    const completedCount = await callWorkflow(page, 'countCompletedChildren', [[
      { id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }
    ], [
      { childId: 'p1', status: 'completed' },
      { childId: 'p2', status: 'in_progress' },
      { childId: 'p3', status: 'completed' }
    ]]);

    expect(new Set(completedIds)).toEqual(new Set(['p1', 'p3']));
    expect(completedCount).toBe(2);
  });

  test('filterPracticePacketRows keeps recent/upcoming rows sorted ascending', async ({ page }) => {
    const result = await callWorkflow(page, 'filterPracticePacketRows', [[
      { id: 'old', date: '2026-01-30T10:00:00.000Z', childIds: ['c1'] },
      { id: 'soon', date: '2026-02-19T10:00:00.000Z', childIds: ['c1'] },
      { id: 'next', date: '2026-02-24T10:00:00.000Z', childIds: ['c2'] }
    ], {
      filter: 'recent_upcoming',
      now: '2026-02-21T00:00:00.000Z'
    }]);

    expect(result.map(row => row.id)).toEqual(['soon', 'next']);
  });

  test('filterPracticePacketRows returns past rows sorted descending and filtered by child', async ({ page }) => {
    const result = await callWorkflow(page, 'filterPracticePacketRows', [[
      { id: 'oldest', date: '2026-01-01T10:00:00.000Z', childIds: ['c1'] },
      { id: 'older', date: '2026-02-03T10:00:00.000Z', childIds: ['c2'] },
      { id: 'recent', date: '2026-02-20T10:00:00.000Z', childIds: ['c1'] }
    ], {
      filter: 'past',
      selectedPlayerId: 'c2',
      now: '2026-02-21T00:00:00.000Z'
    }]);

    expect(result.map(row => row.id)).toEqual(['older']);
  });
});
