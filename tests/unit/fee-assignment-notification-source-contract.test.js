import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

describe('fee assignment notification source contract', () => {
    it('routes new fee recipients to payer-only fees notifications', () => {
        expect(functionsSource).toContain('exports.notifyFeeAssigned = functions.firestore');
        expect(functionsSource).toContain(".document('teams/{teamId}/feeBatches/{batchId}/feeRecipients/{recipientId}')");
        expect(functionsSource).toContain('const payerUserIds = await resolveFeeAssignmentPayerUserIds(teamId, data);');
        expect(functionsSource).toContain("const payerTargets = await getTargetsForCategoryUserIds(teamId, 'fees', payerUserIds, null);");
        expect(functionsSource).toContain('for (const uid of claimedUserIds)');
        expect(functionsSource).toContain('const targetsForUser = claimedTargets.filter');
        expect(functionsSource).toContain('const recipientsForUser = await resolveFeeAssignmentRecipientsForUser({');
        expect(functionsSource).toContain('const payload = buildCombinedFeeAssignmentNotificationPayload(recipientsForUser);');
        expect(functionsSource).toContain('targets: targetsForUser,');
        expect(functionsSource).toContain("category: 'fees',");
        expect(functionsSource).toContain('title: payload.title');
        expect(functionsSource).toContain('body: payload.body');
    });

    it('loads only current-team recipient documents referenced by the payer profile', () => {
        const resolverStart = functionsSource.indexOf('async function resolveFeeAssignmentRecipientsForUser(');
        const resolverEnd = functionsSource.indexOf('\nfunction combineDirectNotificationResults(', resolverStart);
        const resolverSource = functionsSource.slice(resolverStart, resolverEnd);

        expect(resolverSource).toContain("const teamPlayerKeyPrefix = `${teamId}::`;");
        expect(resolverSource).toContain('.filter((playerKey) => playerKey.startsWith(teamPlayerKeyPrefix))');
        expect(resolverSource).toContain("recipientCollection.where('playerKey', 'in'");
        expect(resolverSource).toContain("recipientCollection.where('playerId', 'in'");
        expect(resolverSource).toContain('index += 30');
        expect(functionsSource).not.toContain('listFeeAssignmentBatchRecipients');
    });

    it('deduplicates assignment notifications by parent within a fee batch', () => {
        expect(functionsSource).toContain('function buildFeeAssignmentNotificationClaimRef({ teamId, batchId, uid })');
        expect(functionsSource).toContain('assignmentNotificationClaims/${normalizedUid}');
        expect(functionsSource).toContain('claimFeeAssignmentNotificationUser({ teamId, batchId, recipientId, uid })');
        expect(functionsSource).toContain('const claimedUserIds = new Set(claimResults.filter((result) => result.claimed).map((result) => result.uid));');
        expect(functionsSource).toContain('if (!claimedUserIds.size) return null;');
        expect(functionsSource).toContain('await releaseFeeAssignmentNotificationClaims({');
    });

    it('resolves app-created child fee recipients through player links before sending', () => {
        expect(functionsSource).toContain('function resolveFeeRecipientPlayerId(teamId, recipient = {})');
        expect(functionsSource).toContain('const explicitPlayerId = String(recipient.playerId || recipient.childId || \'\').trim();');
        expect(functionsSource).toContain('playerKey.startsWith(prefix)');
        expect(functionsSource).toContain('getTeamFeeRecipientTargetUserIds({');
        expect(functionsSource).toContain(".where('parentPlayerKeys', 'array-contains', playerKey)");
    });
});
