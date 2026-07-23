import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readPage(name) {
    return readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
}

describe('mobile store legal and support pages', () => {
    it.each([
        ['privacy.html', 'Privacy Policy'],
        ['terms.html', 'Terms of Use'],
        ['support.html', 'ALL PLAYS Support'],
        ['account-deletion.html', 'Delete your ALL PLAYS account']
    ])('publishes %s with its required heading', (file, heading) => {
        const html = readPage(file);

        expect(html).toContain('<meta name="viewport"');
        expect(html).toContain(`<h1>${heading}</h1>`);
        expect(html).toContain('support@allplays.ai');
    });

    it('provides an external account-deletion path into the app', () => {
        const html = readPage('account-deletion.html');

        expect(html).toContain('/app/#/auth?next=');
        expect(html).toContain('DELETE');
        expect(html).toContain('30 days');
        expect(html).toContain('/privacy.html');
    });

    it('links the legal pages together', () => {
        const privacy = readPage('privacy.html');
        const terms = readPage('terms.html');

        expect(privacy).toContain('/terms.html');
        expect(privacy).toContain('/account-deletion.html');
        expect(terms).toContain('/privacy.html');
        expect(terms).toContain('/support.html');
    });

    it('indexes every account-deletion collection-group lookup', () => {
        const indexes = JSON.parse(readPage('firestore.indexes.json'));
        const requiredIndexes = [
            ['messages', 'authorId'],
            ['chatMessages', 'senderId'],
            ['reactions', 'userId'],
            ['rsvps', 'userId'],
            ['rideOffers', 'driverUserId'],
            ['rideRequests', 'parentUserId'],
            ['media', 'uploadedBy'],
            ['mediaItems', 'uploadedBy'],
            ['notificationTargets', 'uid'],
            ['notificationRecipients', 'uid']
        ];

        requiredIndexes.forEach(([collectionGroup, fieldPath]) => {
            const override = indexes.fieldOverrides.find((candidate) =>
                candidate.collectionGroup === collectionGroup && candidate.fieldPath === fieldPath
            );
            expect(override?.indexes).toContainEqual({
                order: 'ASCENDING',
                queryScope: 'COLLECTION_GROUP'
            });
        });
    });
});
