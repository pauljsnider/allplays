import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const functionsSource = fs.readFileSync(path.join(repoRoot, 'functions/index.js'), 'utf8');
const rulesSource = fs.readFileSync(path.join(repoRoot, 'firestore.rules'), 'utf8');

describe('account merge preview callable source contract', () => {
    it('requires authentication before account merge preview', () => {
        const callableStart = functionsSource.indexOf('exports.previewAccountMerge = functions.https.onCall');
        expect(callableStart).toBeGreaterThan(0);
        const authCheck = functionsSource.slice(callableStart, callableStart + 500);
        expect(authCheck).toContain("HttpsError('unauthenticated'");
        expect(authCheck).toContain('Sign in before previewing an account merge');
    });

    it('rejects missing source accounts and self-merge attempts', () => {
        expect(functionsSource).toContain('normalizeAccountMergePreviewInput(data || {})');
        expect(functionsSource).toContain('assertNotSelfMerge({');
        expect(functionsSource).toContain("HttpsError('not-found', 'Source account could not be found.')");
    });

    it('requires a verification token before resolving source account data', () => {
        const callableStart = functionsSource.indexOf('exports.previewAccountMerge = functions.https.onCall');
        const callableSource = functionsSource.slice(callableStart, functionsSource.indexOf('async function logRsvpTokenRedemptionAttempt', callableStart));

        expect(callableSource).toContain('requireAccountMergeVerificationToken(input)');
        expect(callableSource).toContain("errorCode: 'failed-precondition'");
        expect(callableSource).not.toContain('findAccountMergeSourceByEmail');
        expect(functionsSource).not.toContain(".where('email', '==', sourceEmail)");
        expect(functionsSource).not.toContain(".where('profileEmail', '==', sourceEmail)");
    });

    it('persists the accepted verification token document id in audits', () => {
        expect(functionsSource).toContain('id: tokenSnap.id');
        expect(functionsSource).toContain('verificationTokenId: sourceResult.verification?.id || null');
    });

    it('writes audit records without mutating ownership links', () => {
        expect(functionsSource).toContain("firestore.collection('accountMergePreviewRequests')");
        expect(functionsSource).toContain('didMutateOwnershipLinks: false');
        expect(functionsSource).not.toContain('previewAccountMerge = functions.https.onCall(async (data, context) => {\n  transaction.update');
        expect(rulesSource).toContain('match /accountMergePreviewRequests/{requestId}');
        expect(rulesSource).toContain('allow write: if false;');
    });
});
