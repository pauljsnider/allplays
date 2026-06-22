import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

describe('fee assignment notification source contract', () => {
    it('routes new fee recipients to payer-only fees notifications', () => {
        expect(functionsSource).toContain('exports.notifyFeeAssigned = functions.firestore');
        expect(functionsSource).toContain(".document('teams/{teamId}/feeBatches/{batchId}/feeRecipients/{recipientId}')");
        expect(functionsSource).toContain('const payerUserIds = await resolveFeeAssignmentPayerUserIds(teamId, data);');
        expect(functionsSource).toContain("const payerTargets = await getTargetsForCategoryUserIds(teamId, 'fees', payerUserIds, null);");
        expect(functionsSource).toContain('targets: claimedTargets,');
        expect(functionsSource).toContain("category: 'fees',");
        expect(functionsSource).toContain('title: `New fee assigned: ${title}${amountDisplay}`');
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
