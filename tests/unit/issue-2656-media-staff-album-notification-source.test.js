import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const mediaRecipientTestSource = readFileSync(new URL('./team-media-notification-recipients.test.js', import.meta.url), 'utf8');

describe('issue 2656 media staff-only album notification source contract', () => {
    it('keeps restricted album visibility normalized before media notifications are queued', () => {
        expect(functionsSource).toContain('function buildTeamMediaNotificationAudienceContext(folder = {})');
        expect(functionsSource).toContain('const albumVisibility = normalizeTeamMediaNotificationVisibility(folder.visibility);');
        expect(functionsSource).toContain('audienceContext,');
        expect(functionsSource).toContain('albumVisibility,');
        expect(functionsSource).toContain('function normalizeNotificationAlbumVisibility(value)');
        expect(functionsSource).toContain("return ['private', 'staff', 'staff-only'].includes(normalized) ? 'private' : 'team';");
    });

    it('keeps parent media notification suppression covered for staff-only albums', () => {
        expect(functionsSource).toContain('if (category !== \'media\') return true;');
        expect(functionsSource).toContain('const albumVisibility = audienceContext?.staffOnly === true');
        expect(functionsSource).toContain("if (albumVisibility === 'private') {");
        expect(functionsSource).toContain("const isStaffUser = Array.isArray(user.roles) && user.roles.includes('staff');");
        expect(functionsSource).toContain('if (!isStaffUser) return false;');

        expect(mediaRecipientTestSource).toContain('filters restricted-album media recipients down to staff-only targets');
        expect(mediaRecipientTestSource).toContain("{ albumVisibility: 'staff-only' }");
        expect(mediaRecipientTestSource).toContain("{ albumVisibility: 'staff_only' }");
        expect(mediaRecipientTestSource).toContain("{ albumVisibility: 'team', staffOnly: true }");
    });
});
