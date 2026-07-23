import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

function getFunctionSource(functionName) {
  const start = dbSource.indexOf(`export async function ${functionName}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const nextExport = dbSource.indexOf('\nexport async function ', start + 1);
  return dbSource.slice(start, nextExport === -1 ? dbSource.length : nextExport);
}

describe('team access query resilience', () => {
  it('keeps public and owned teams when the optional admin-email query is denied', () => {
    const source = getFunctionSource('getTeams');
    expect(source).toContain("where(\"adminEmails\", \"array-contains\", currentUserEmail)");
    expect(source).toContain('.catch((error) => {');
    expect(source).toContain('continuing with public and owned teams');
  });

  it('keeps owned and owner-email teams when the optional admin-email query is denied', () => {
    const source = getFunctionSource('getUserTeamsWithAccess');
    expect(source).toContain("where(\"adminEmails\", \"array-contains\", normalizedEmail)");
    expect(source).toContain('optionalTeamQuery(');
    expect(source).toContain('`adminEmails:${normalizedEmail}`');
  });
});
