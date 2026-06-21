import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readProjectFile(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('profile access code pagination contract', () => {
    it('uses an ordered cursor-limited access-code query for app invite history pages', () => {
        const dbSource = readProjectFile('js/db.js');
        const profileServiceSource = readProjectFile('apps/app/src/lib/profileService.ts');
        const profilePageSource = readProjectFile('apps/app/src/pages/Profile.tsx');

        expect(dbSource).toContain('export async function getUserAccessCodesPage');
        expect(dbSource).toContain('orderBy("createdAt", "desc")');
        expect(dbSource).toContain('startAfter(options.cursor)');
        expect(dbSource).toContain('limit(pageSize)');
        expect(profileServiceSource).toContain('getUserAccessCodesPage(userId, { cursor, pageSize })');
        expect(profilePageSource).toContain('loadProfileAccessCodesPage(user.uid, { pageSize: collapsedInviteCount })');
        expect(profilePageSource).not.toContain('setAccessCodes(await loadProfileAccessCodes(user.uid))');
    });
});
