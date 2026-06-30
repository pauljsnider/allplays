import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentSource = readFileSync(
  resolve(process.cwd(), 'src/app/team-fees/team-fees.component.ts'),
  'utf8'
);

describe('Team Fees parent-linked recipient queries', () => {
  it('fetches child-linked fee recipients only by rules-authorized player fields', () => {
    expect(componentSource).toContain('...childLinks.flatMap((child) => [');
    expect(componentSource).toContain("where('playerId', '==', child.playerId)");
    expect(componentSource).toContain("where('playerKey', '==', getParentPlayerKey(child.teamId || '', child.playerId || ''))");
    expect(componentSource).not.toContain("where('childId', '==', child.playerId)");
  });
});
