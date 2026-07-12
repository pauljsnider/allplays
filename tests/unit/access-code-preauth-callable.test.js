import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readFunctionsIndex() {
    return readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
}

describe('access code pre-auth callable guard', () => {
    it('returns a generic response before querying access code documents for anonymous callers', () => {
        const source = readFunctionsIndex();
        const functionStart = source.indexOf('exports.validateAccessCodeForAcceptance');
        const functionEnd = source.indexOf('function accountMergePreviewAuditRef', functionStart);
        const callableSource = source.slice(functionStart, functionEnd);
        const authGuardIndex = callableSource.indexOf('if (!acceptingUserId)');
        const nativeTokenIndex = callableSource.indexOf('const nativeAuthToken');
        const nativeVerifyIndex = callableSource.indexOf('admin.auth().verifyIdToken(nativeAuthToken)');
        const queryIndex = callableSource.indexOf("firestore.collection('accessCodes').where('code', '==', code).get()");

        expect(callableSource).toContain('functions.https.onCall(async (data, context) => {');
        expect(callableSource).toContain('return buildGenericPreAuthAccessCodeValidationResult();');
        expect(authGuardIndex).toBeGreaterThan(-1);
        expect(nativeTokenIndex).toBeGreaterThan(-1);
        expect(nativeVerifyIndex).toBeGreaterThan(nativeTokenIndex);
        expect(queryIndex).toBeGreaterThan(-1);
        expect(nativeVerifyIndex).toBeLessThan(queryIndex);
        expect(authGuardIndex).toBeLessThan(queryIndex);
        expect(callableSource).toContain('Date.now(), acceptingUserId');
    });
});
