import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentSource = readFileSync(
  resolve(process.cwd(), 'js/db.js'),
  'utf8'
);

describe('Team Fees parent-linked recipient queries', () => {
  it('fetches child-linked fee recipients only by rules-authorized player fields', () => {
    expect(componentSource).toContain('...childLinks.map((child) => query(');
    expect(componentSource).toContain("where('teamId', '==', child.teamId)");
    expect(componentSource).toContain("where('playerId', '==', child.playerId)");
    expect(componentSource).not.toContain("where('childId', '==', child.playerId)");
  });
});
