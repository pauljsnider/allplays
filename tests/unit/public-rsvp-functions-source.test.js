import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

function getSourceSection(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = source.indexOf(endMarker, start);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
}

describe('public RSVP function safeguards', () => {
    it('does not ship hardcoded Twilio credentials', () => {
        expect(source).not.toMatch(/AC[0-9a-f]{32}/i);
        expect(source).not.toMatch(/authToken\s*=\s*['"][^'"]+['"]/);
    });

    it('allows platform admins to send public RSVP reminders', () => {
        expect(source).toContain("firestore.doc(`users/${tokenData.uid}`).get()");
        expect(source).toContain('user?.isAdmin === true');
        expect(source).toContain('publicRsvpUserCanManageTeam({ team, user, uid: tokenData.uid, email: tokenData.email })');
    });

    it('aggregates public RSVP summaries by active player', () => {
        expect(source).toContain('const responsesByPlayerId = new Map();');
        expect(source.indexOf('const updateTime = coercePublicRsvpDate(docSnap?.updateTime);'))
            .toBeLessThan(source.indexOf("const respondedAt = coercePublicRsvpDate(rsvp?.respondedAt || rsvp?.updatedAt || rsvp?.createdAt);"));
        expect(source).toContain('responsesByPlayerId.set(playerId, { response, respondedAtMs });');
        expect(source).toContain('summary.notResponded = Math.max(activePlayerIds.size - responsesByPlayerId.size, 0);');
        expect(source).toContain('summary.notRespondedPlayerIds = Array.from(activePlayerIds)');
        expect(source).not.toContain('summary.going += increment');
        expect(source).not.toContain('summary.maybe += increment');
        expect(source).not.toContain('summary.notGoing += increment');
    });

    it('submits public RSVPs with an atomically enqueued durable summary refresh', () => {
        const submitSource = getSourceSection(
            'exports.submitPublicRsvp = functions.https.onRequest',
            'exports.collectTelemetry'
        );

        expect(submitSource).toContain('await assertUsablePublicRsvpToken(tokenData)');
        expect(submitSource).toContain("firestore.collection('publicRsvpSummaryRefreshJobs').doc()");
        expect(submitSource).toContain('batch.set(playerStateRef, {');
        expect(submitSource).toContain('batch.set(jobRef, {');
        expect(submitSource).toContain('await batch.commit()');
        expect(submitSource).not.toContain('await buildPublicRsvpSummary');
        expect(submitSource).not.toContain("firestore.collection(`teams/${tokenData.teamId}/players`).get()");
        expect(submitSource).not.toContain("firestore.collection(`teams/${tokenData.teamId}/games/${tokenData.gameId}/rsvps`).get()");
        expect(submitSource.indexOf('await batch.commit()'))
            .toBeLessThan(submitSource.indexOf('res.status(200).json'));
    });

    it('awaits the durable worker lifecycle and verifies per-player job ordering', () => {
        const workerSource = getSourceSection(
            'async function tryApplyPublicRsvpSummaryDelta',
            'async function getPublicRsvpTokenData'
        );

        expect(workerSource).toContain('buildPublicRsvpSummaryJobPlan({');
        expect(workerSource).toContain("if (plan.mode === 'obsolete' || plan.mode === 'already_applied') return true;");
        expect(workerSource).toContain(".document('publicRsvpSummaryRefreshJobs/{jobId}')");
        expect(workerSource).toContain('await processPublicRsvpSummaryRefresh(input)');
        expect(workerSource).toContain('await jobSnap.ref.delete()');
        expect(workerSource).not.toContain('schedulePublicRsvpSummaryRefresh');
    });

    it('chunks public RSVP email writes before hitting the Firestore batch limit', () => {
        expect(source).toContain('const PUBLIC_RSVP_EMAIL_BATCH_WRITE_LIMIT = 500;');
        expect(source).toContain('const ensurePublicRsvpEmailBatchCapacity = () => {');
        expect(source).toContain('if (batchWriteCount + 2 <= PUBLIC_RSVP_EMAIL_BATCH_WRITE_LIMIT) return;');
        expect(source).toContain('batchWriteCount += 2;');
        expect(source).toContain('for (const publicRsvpEmailBatch of batches) {');
        expect(source).toContain('await publicRsvpEmailBatch.commit();');
    });
});
