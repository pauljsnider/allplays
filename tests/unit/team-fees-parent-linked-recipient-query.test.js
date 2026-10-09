import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentSource = readFileSync(
  resolve(process.cwd(), 'js/db.js'),
  'utf8'
);

describe('Team Fees parent-linked recipient discovery', () => {
  it('routes discovery through the bounded callable without browser fee-recipient queries', () => {
    const start = componentSource.indexOf('export async function listParentTeamFeeRecipients');
    const end = componentSource.indexOf('\n\nexport async function getTeamFeeBatch', start);
    const loaderSource = componentSource.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(loaderSource).toContain("httpsCallable(functions, 'listParentTeamFeeRecipients')");
    expect(loaderSource).toContain('const result = await callable({});');
    expect(loaderSource).not.toContain("collectionGroup(db, 'feeRecipients')");
    expect(loaderSource).not.toContain('getDocs(');
  });
});
