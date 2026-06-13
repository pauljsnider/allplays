import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function readFile(relPath) {
    return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function extractRequestRideSpotSection(source) {
    const start = source.indexOf('export async function requestRideSpot(');
    const end = source.indexOf('/**\n * Driver/admin updates request status with seat-capacity protection.\n */', start);
    return start >= 0 && end > start ? source.slice(start, end) : '';
}

describe('rideshare re-request policy', () => {
    it('re-requests existing declined or waitlisted requests as a controlled update', () => {
        const source = extractRequestRideSpotSection(readFile('js/db.js'));

        expect(source).toContain('export async function requestRideSpot(teamId, gameId, offerId, payload = {}) {');
        expect(source).toContain('const offerRef = doc(db, `teams/${teamId}/games/${gameId}/rideOffers`, offerId);');
        expect(source).toContain('const requestRef = doc(db, `teams/${teamId}/games/${gameId}/rideOffers/${offerId}/requests`, requestId);');
        expect(source).toContain('return runTransaction(db, async (tx) => {');
        expect(source).toContain('const [offerSnap, existingRequestSnap] = await Promise.all([tx.get(offerRef), tx.get(requestRef)]);');
        expect(source).toContain("if (offerStatus !== RIDE_OFFER_STATUS.OPEN) throw new Error('Ride offer is closed.');");
        expect(source).toContain("if (existingStatus && existingStatus !== RIDE_REQUEST_STATUS.DECLINED && existingStatus !== RIDE_REQUEST_STATUS.WAITLISTED)");
        expect(source).not.toContain("throw new Error('Offer is full.');");
        expect(source).toContain('tx.update(requestRef, requestPayload);');
        expect(source).toContain('tx.set(requestRef, {');
        expect(source).toContain('status: RIDE_REQUEST_STATUS.PENDING');
        expect(source).toContain('requestedAt: requestedAt');
        expect(source).toContain('respondedAt: null');
        expect(source).not.toContain('}, { merge: true });');
    });

    it('allows parents to move declined or waitlisted requests back to pending in firestore rules', () => {
        const rules = readFile('firestore.rules');

        expect(rules).toContain('resource.data.status in [\'declined\', \'waitlisted\']');
        expect(rules).toContain('request.resource.data.status == \'pending\'');
        expect(rules).toContain('request.resource.data.respondedAt == null');
        expect(rules).toContain('isParentForPlayer(teamId, resource.data.childId)');
        expect(rules).toContain('request.resource.data.diff(resource.data).affectedKeys().hasOnly([\'childName\', \'status\', \'requestedAt\', \'respondedAt\', \'updatedAt\'])');
        expect(rules).toContain('function isRideshareOfferAcceptingRequests(teamId, gameId, offerId)');
        expect(rules).not.toContain('get(offerPath).data.seatCountConfirmed < get(offerPath).data.seatCapacity');
        expect(rules).toContain('isRideshareOfferAcceptingRequests(teamId, gameId, offerId)');
    });
});
