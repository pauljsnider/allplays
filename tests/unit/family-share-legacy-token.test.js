import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRepoFile(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('legacy family page server projection', () => {
    it('uses only the versioned callable response before rendering family data', () => {
        const familyPage = readRepoFile('family.html');

        expect(familyPage).toContain("import { getFamilyShareView } from './js/db.js");
        expect(familyPage).toContain('viewProjection = await getFamilyShareView(tokenId)');
        expect(familyPage).toContain('function isUsableFamilyShareViewProjection(projection)');
        expect(familyPage).toContain('Number(projection?.projectionVersion) !== 2');
        expect(familyPage).toContain('!Array.isArray(team.games)');
        expect(familyPage).toContain("!toDateSafe(game.date)");
        expect(familyPage).toContain("!['game', 'practice'].includes(event.type)");
        expect(familyPage).toContain('new Set(normalizedWarnings).size !== projection.calendarWarnings.length');
        expect(familyPage).toContain('function normalizeFamilyPageChildren(children = [])');
        expect(familyPage).toContain('const children = normalizeFamilyPageChildren(viewProjection.children);');
        expect(familyPage).not.toContain('getFamilyShareToken');
        expect(familyPage).not.toContain('resolveFamilyShareTokenChildren');
        expect(familyPage).not.toContain('extraCalendarUrls');
        expect(familyPage).not.toContain('getTeam(');
        expect(familyPage).not.toContain('getGames(');
    });

    it('filters children without both IDs and rejects duplicate links', () => {
        const familyPage = readRepoFile('family.html');

        expect(familyPage).toContain('if (!child.teamId || !child.playerId) return false;');
        expect(familyPage).toContain('if (seen.has(childKey)) return false;');
    });

    it('fails retryably when the complete v2 projection is unavailable', () => {
        const familyPage = readRepoFile('family.html');

        expect(familyPage).toContain("const authoritativeReason = getAuthoritativeFamilyShareProjectionErrorReason(err)");
        expect(familyPage).toContain("return ['invalid', 'revoked', 'expired'].includes(reason) ? reason : '';");
        expect(familyPage).toContain("id=\"page-error-retry\"");
        expect(familyPage).toContain("showError('Family page temporarily busy', retryDetail, { retryable: true });");
        expect(familyPage).toContain("'The complete family page could not be loaded. Please retry in a moment.'");
        expect(familyPage).toContain("document.getElementById('page-error-retry')?.addEventListener('click'");
    });

    it('creates tokens with a 30-day expiry window', () => {
        const dbSource = readRepoFile('js/db.js');

        expect(dbSource).toContain('FAMILY_SHARE_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000');
    });

    it('includes ownerUserId in created token documents for owner-only list queries', () => {
        const dbSource = readRepoFile('js/db.js');

        expect(dbSource).toContain('ownerUserId');
        expect(dbSource).toContain("where('ownerUserId', '==', ownerUserId)");
    });
});
