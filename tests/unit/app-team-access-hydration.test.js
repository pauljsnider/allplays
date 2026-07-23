import { describe, expect, it } from 'vitest';
import { mergeOwnedTeamIds } from '../../apps/app/src/lib/teamAccess.ts';

describe('mergeOwnedTeamIds', () => {
  it('adds owned teams even when the stored coachOf list is already non-empty', () => {
    expect(mergeOwnedTeamIds(
      ['jr-kc-current'],
      [{ id: 'jr-kc-current' }, { id: 'vipers' }]
    )).toEqual(['jr-kc-current', 'vipers']);
  });

  it('normalizes invalid and duplicate IDs', () => {
    expect(mergeOwnedTeamIds(
      [' team-1 ', '', null],
      [{ id: 'team-1' }, { id: ' team-2 ' }, {}, null]
    )).toEqual(['team-1', 'team-2']);
  });
});
