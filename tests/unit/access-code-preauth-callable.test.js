import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readFunctionsIndex() {
    return readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
}

function readValidationCore() {
    return readFileSync(new URL('../../functions/access-code-validation.cjs', import.meta.url), 'utf8');
}

describe('access code pre-auth callable guard', () => {
    it('returns a generic response before querying access code documents for anonymous callers', () => {
        const source = readFunctionsIndex();
        const functionStart = source.indexOf('exports.validateAccessCodeForAcceptance');
        const functionEnd = source.indexOf('function accountMergePreviewAuditRef', functionStart);
        const callableSource = source.slice(functionStart, functionEnd);
        const handlerIndex = callableSource.indexOf('createAccessCodeValidationHandler');

        expect(callableSource).toContain('functions.https.onCall(async (data, context) => {');
        expect(handlerIndex).toBeGreaterThan(-1);
        expect(callableSource).toContain('return handler(data, context);');
        expect(callableSource).not.toContain("firestore.collection('accessCodes')");
    });

    it('keeps authentication and both persistent reservations before the access-code lookup', () => {
        const source = readValidationCore();
        const handlerStart = source.indexOf('return async function validateAccessCodeForAcceptance');
        const handlerEnd = source.indexOf('\n  };', handlerStart);
        const handlerSource = source.slice(handlerStart, handlerEnd);
        const authGuardIndex = handlerSource.indexOf('if (!acceptingUserId)');
        const uidReservationIndex = handlerSource.indexOf('prepareUidReservation');
        const networkReservationIndex = handlerSource.indexOf('prepareNetworkReservation');
        const transactionIndex = handlerSource.indexOf('firestore.runTransaction');
        const queryIndex = handlerSource.indexOf("firestore.collection('accessCodes')");

        expect(authGuardIndex).toBeGreaterThan(-1);
        expect(uidReservationIndex).toBeGreaterThan(authGuardIndex);
        expect(networkReservationIndex).toBeGreaterThan(uidReservationIndex);
        expect(transactionIndex).toBeGreaterThan(networkReservationIndex);
        expect(queryIndex).toBeGreaterThan(transactionIndex);
        expect(handlerSource).toContain("'resource-exhausted'");
        expect(handlerSource).toContain('{ retryAfterSeconds }');
    });
});
