import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

/**
 * Regression guard for #3416: the app finalizes a schedule import by writing
 * teams/{teamId}/scheduleImportNotificationBatches/{batchId} with the client SDK
 * (apps/app/src/lib/scheduleService.ts finalizeScheduleImportBatch). Before this
 * fix there was no match block, so the deny-all catch-all rejected every write and
 * partial imports silently never notified parents.
 */
describe('schedule import notification batch Firestore rules', () => {
    it('defines a match block for scheduleImportNotificationBatches', () => {
        const occurrences = rules.split('match /scheduleImportNotificationBatches/{batchId}').length - 1;
        expect(occurrences).toBe(1);
    });

    it('restricts writes to team staff and only the finalize fields', () => {
        const blockStart = rules.indexOf('match /scheduleImportNotificationBatches/{batchId}');
        expect(blockStart).toBeGreaterThan(-1);
        const block = rules.slice(blockStart, blockStart + 800);

        expect(block).toContain('allow read: if isTeamOwnerOrAdmin(teamId)');
        expect(block).toContain('allow create: if isTeamOwnerOrAdmin(teamId)');
        expect(block).toContain('allow update: if isTeamOwnerOrAdmin(teamId)');
        // Only the finalize fields are writable; server-owned fields stay admin-only.
        expect(block).toContain("hasOnly(['batchId', 'totalCount', 'importCompletedAt', 'updatedAt', 'finalizedBy'])");
        expect(block).toContain('request.resource.data.finalizedBy == request.auth.uid');
        // Updates must scope the writable key set to the diff so a client cannot
        // clobber server-managed fields such as eventIds or sentAt.
        expect(block).toContain('request.resource.data.diff(resource.data).affectedKeys()');
    });

    it('does not leave the collection to the deny-all catch-all', () => {
        // The batch collection must be matched before the terminal deny-all block.
        const batchIndex = rules.indexOf('match /scheduleImportNotificationBatches/{batchId}');
        const denyAllIndex = rules.indexOf('match /{document=**}');
        expect(batchIndex).toBeGreaterThan(-1);
        expect(denyAllIndex).toBeGreaterThan(-1);
        expect(batchIndex).toBeLessThan(denyAllIndex);
    });
});
