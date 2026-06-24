import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readProjectFile(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('profile access code pagination contract', () => {
    it('uses the no-index access-code read path for app invite history pages', () => {
        const dbSource = readProjectFile('js/db.js');
        const profileServiceSource = readProjectFile('apps/app/src/lib/profileService.ts');
        const profilePageSource = readProjectFile('apps/app/src/pages/Profile.tsx');
        const start = dbSource.indexOf('export async function getUserAccessCodesPage');
        const end = dbSource.indexOf('export async function getTeamAccessCodes', start);
        const helperSource = dbSource.slice(start, end);

        expect(dbSource).toContain('export async function getUserAccessCodesPage');
        expect(helperSource).toContain('const codes = await getUserAccessCodes(userId);');
        expect(helperSource).toContain('const pageCodes = codes.slice(offset, offset + pageSize);');
        expect(helperSource).toContain('nextCursor: nextOffset < codes.length ? nextOffset : null');
        expect(helperSource).not.toContain('orderBy("createdAt"');
        expect(helperSource).not.toContain('startAfter(options.cursor)');
        expect(profileServiceSource).toContain('getUserAccessCodesPage(userId, { cursor, pageSize })');
        expect(profilePageSource).toContain('loadProfileAccessCodesPage(user.uid, { pageSize: collapsedInviteCount })');
        expect(profilePageSource).not.toContain('setAccessCodes(await loadProfileAccessCodes(user.uid))');
    });
});
