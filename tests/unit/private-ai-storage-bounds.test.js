import { describe, expect, it } from 'vitest';
import {
    assertPrivateAiPendingPayloadFitsFirestore,
    getSerializedUtf8ByteLength,
    PRIVATE_AI_PENDING_PAYLOAD_MAX_JSON_BYTES
} from '../../apps/app/src/lib/privateAiStorageBounds.ts';

function buildNearLimitPayload(extraBytes = 0) {
    const emptyArgs = { teamId: 'team-1', rows: [{ notes: '' }] };
    const artifact = { type: 'schedule-import', previewRows: [] };
    const baseline = getSerializedUtf8ByteLength({ args: emptyArgs, artifact });
    return {
        args: {
            teamId: 'team-1',
            rows: [{ notes: 'x'.repeat(PRIVATE_AI_PENDING_PAYLOAD_MAX_JSON_BYTES - baseline + extraBytes) }]
        },
        artifact
    };
}

describe('private AI pending-action storage bounds', () => {
    it('measures serialized UTF-8 bytes rather than JavaScript characters', () => {
        expect(getSerializedUtf8ByteLength('é')).toBe(4);
    });

    it('accepts a schedule payload at the configured safe boundary', () => {
        const payload = buildNearLimitPayload();

        expect(assertPrivateAiPendingPayloadFitsFirestore('schedule', payload.args, payload.artifact))
            .toBe(PRIVATE_AI_PENDING_PAYLOAD_MAX_JSON_BYTES);
    });

    it('rejects oversized schedule and roster payloads with split-import guidance', () => {
        const payload = buildNearLimitPayload(1);

        expect(() => assertPrivateAiPendingPayloadFitsFirestore('schedule', payload.args, payload.artifact))
            .toThrow(/schedule import is too large.*Split it into smaller files/s);
        expect(() => assertPrivateAiPendingPayloadFitsFirestore('roster', payload.args, payload.artifact))
            .toThrow(/roster import is too large.*Split it into smaller files/s);
    });
});
