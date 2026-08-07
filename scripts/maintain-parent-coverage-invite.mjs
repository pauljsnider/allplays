import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
    createFirebaseRestSession,
    createFirestoreDocument,
    findFirestoreDocumentsByStringField,
    getFirestoreDocument
} from '../tests/smoke/helpers/firebase-rest.js';
import { assertSmokeFixtureIdentifier } from './maintain-production-smoke-official-fixture.mjs';

const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const redemptionFixtureMarker = 'parent-coverage-redemption-v1';

function randomInviteCode() {
    const bytes = randomBytes(8);
    return [...bytes].map((byte) => codeAlphabet[byte % codeAlphabet.length]).join('');
}

function stringValue(fields, name) {
    return String(fields?.[name]?.stringValue || '');
}

function boolValue(fields, name) {
    return fields?.[name]?.booleanValue === true;
}

function normalizedStatus(fields) {
    return stringValue(fields, 'status').trim().toLowerCase();
}

function timestampMillis(fields, name) {
    return Date.parse(String(fields?.[name]?.timestampValue || '')) || 0;
}

export function buildRedemptionTeamFields({ staffUid, staffEmail, now = new Date() }) {
    const timestamp = now.toISOString();
    return {
        name: { stringValue: 'AllPlays Smoke Parent Census Redemption' },
        ownerId: { stringValue: staffUid },
        adminEmails: {
            arrayValue: {
                values: [{ stringValue: staffEmail.trim().toLowerCase() }]
            }
        },
        fixtureType: { stringValue: redemptionFixtureMarker },
        active: { booleanValue: true },
        archived: { booleanValue: false },
        isPublic: { booleanValue: false },
        status: { stringValue: 'active' },
        createdAt: { timestampValue: timestamp },
        updatedAt: { timestampValue: timestamp }
    };
}

export function buildRedemptionPlayerFields(teamId, now = new Date()) {
    const timestamp = now.toISOString();
    return {
        name: { stringValue: 'AllPlays Smoke Parent Census Redemption Player' },
        teamId: { stringValue: teamId },
        fixtureType: { stringValue: redemptionFixtureMarker },
        active: { booleanValue: true },
        archived: { booleanValue: false },
        status: { stringValue: 'active' },
        createdAt: { timestampValue: timestamp },
        updatedAt: { timestampValue: timestamp }
    };
}

export function inspectRedemptionFixture(teamDocument, playerDocument, { staffUid, teamId }) {
    const team = teamDocument?.fields || {};
    const player = playerDocument?.fields || {};
    const teamOwned = stringValue(team, 'ownerId') === staffUid;
    const teamMarked = stringValue(team, 'fixtureType') === redemptionFixtureMarker;
    const playerMarked = stringValue(player, 'fixtureType') === redemptionFixtureMarker;
    const playerBound = stringValue(player, 'teamId') === teamId;
    const teamPrivate = team.isPublic?.booleanValue === false;
    const teamActive = team.active?.booleanValue === true && team.archived?.booleanValue !== true &&
        normalizedStatus(team) === 'active';
    const playerActive = player.active?.booleanValue === true && player.archived?.booleanValue !== true &&
        normalizedStatus(player) === 'active';
    return {
        ready: Boolean(teamDocument && playerDocument) && teamOwned && teamMarked && playerMarked &&
            playerBound && teamPrivate && teamActive && playerActive,
        teamOwned,
        teamMarked,
        playerMarked,
        playerBound,
        teamPrivate,
        teamActive,
        playerActive
    };
}

async function ensureRedemptionFixture(
    mode,
    lookupSession,
    staffSession,
    staffEmail,
    teamId,
    playerId
) {
    assertSmokeFixtureIdentifier(teamId, 'Redemption team ID');
    assertSmokeFixtureIdentifier(playerId, 'Redemption player ID');
    const teamPath = `teams/${teamId}`;
    const playerPath = `${teamPath}/players/${playerId}`;
    // A team manager cannot read a nonexistent team path under production
    // rules. Use the protected admin only to distinguish missing from an
    // existing collision; all fixture writes still use the staff session.
    let teamDocument = await getFirestoreDocument(lookupSession, teamPath);
    if (teamDocument && stringValue(teamDocument.fields, 'fixtureType') !== redemptionFixtureMarker) {
        throw new Error('redemption team ID collides with a non-census fixture');
    }
    if (!teamDocument) {
        if (mode !== 'repair') throw new Error('the dedicated redemption team fixture is unavailable');
        await createFirestoreDocument(staffSession, teamPath, buildRedemptionTeamFields({
            staffUid: staffSession.localId,
            staffEmail
        }));
        teamDocument = await getFirestoreDocument(staffSession, teamPath);
    }
    if (stringValue(teamDocument?.fields, 'ownerId') !== staffSession.localId) {
        throw new Error('the dedicated redemption team is not owned by the protected staff fixture');
    }
    let playerDocument = await getFirestoreDocument(staffSession, playerPath);
    if (playerDocument && stringValue(playerDocument.fields, 'fixtureType') !== redemptionFixtureMarker) {
        throw new Error('redemption player ID collides with a non-census fixture');
    }
    if (!playerDocument) {
        if (mode !== 'repair') throw new Error('the dedicated redemption player fixture is unavailable');
        await createFirestoreDocument(
            staffSession,
            playerPath,
            buildRedemptionPlayerFields(teamId)
        );
        playerDocument = await getFirestoreDocument(staffSession, playerPath);
    }
    const inspection = inspectRedemptionFixture(teamDocument, playerDocument, {
        staffUid: staffSession.localId,
        teamId
    });
    if (!inspection.ready) throw new Error('the dedicated redemption fixture is not active and purpose-bound');
}

export function matchesUsableInvite(document, recipient, purpose, teamId, playerId, now = Date.now()) {
    const fields = document?.fields || {};
    return stringValue(fields, 'type') === 'parent_invite' &&
        stringValue(fields, 'email').toLowerCase() === recipient.toLowerCase() &&
        stringValue(fields, 'relation') === `Parent census ${purpose}` &&
        stringValue(fields, 'teamId') === teamId &&
        stringValue(fields, 'playerId') === playerId &&
        !boolValue(fields, 'used') &&
        timestampMillis(fields, 'expiresAt') > now + 60 * 60 * 1000;
}

async function createInvite(session, recipient, purpose, teamId, playerId) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = randomInviteCode();
        const now = new Date();
        try {
            await createFirestoreDocument(session, `accessCodes/${code}`, {
                code: { stringValue: code },
                type: { stringValue: 'parent_invite' },
                generatedBy: { stringValue: session.localId },
                email: { stringValue: recipient },
                teamId: { stringValue: teamId },
                playerId: { stringValue: playerId },
                relation: { stringValue: `Parent census ${purpose}` },
                createdAt: { timestampValue: now.toISOString() },
                expiresAt: { timestampValue: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString() },
                used: { booleanValue: false },
                usedBy: { nullValue: 'NULL_VALUE' },
                usedAt: { nullValue: 'NULL_VALUE' }
            });
            return;
        } catch (error) {
            const message = String(error?.message || '');
            if (!message.includes('status 409') && !message.includes('status 412')) throw error;
        }
    }
    throw new Error('unable to reserve a unique lifecycle invite');
}

async function main() {
    const mode = String(process.env.PARENT_CENSUS_PROVISION_MODE || 'audit');
    if (!['audit', 'repair'].includes(mode)) throw new Error('provision mode must be audit or repair');
    const appBaseUrl = String(process.env.SMOKE_APP_BASE_URL || '');
    const adminEmail = String(process.env.PARENT_CENSUS_ADMIN_EMAIL || '');
    const adminPassword = String(process.env.PARENT_CENSUS_ADMIN_PASSWORD || '');
    const staffEmail = String(process.env.PARENT_CENSUS_STAFF_EMAIL || '');
    const staffPassword = String(process.env.PARENT_CENSUS_STAFF_PASSWORD || '');
    const lifecycleEmail = String(process.env.PARENT_CENSUS_LIFECYCLE_EMAIL || '');
    const teamId = String(process.env.PARENT_CENSUS_TEAM_ID || '');
    const playerId = String(process.env.PARENT_CENSUS_PLAYER_ID || '');
    const redemptionTeamId = String(process.env.PARENT_CENSUS_REDEMPTION_TEAM_ID || '');
    const redemptionPlayerId = String(process.env.PARENT_CENSUS_REDEMPTION_PLAYER_ID || '');
    if (
        !appBaseUrl || !adminEmail || !adminPassword || !staffEmail || !staffPassword || !lifecycleEmail ||
        !teamId || !playerId || !redemptionTeamId || !redemptionPlayerId
    ) {
        throw new Error('protected parent census invite configuration is incomplete');
    }
    if (redemptionTeamId === teamId) {
        throw new Error('team-redemption lifecycle invite must target a distinct team');
    }
    const [session, staffSession] = await Promise.all([
        createFirebaseRestSession({ appBaseUrl, email: adminEmail, password: adminPassword }),
        createFirebaseRestSession({ appBaseUrl, email: staffEmail, password: staffPassword })
    ]);
    await ensureRedemptionFixture(
        mode,
        session,
        staffSession,
        staffEmail,
        redemptionTeamId,
        redemptionPlayerId
    );
    const invites = await findFirestoreDocumentsByStringField(session, 'accessCodes', 'generatedBy', session.localId);
    const inviteTargets = [
        { purpose: 'signup', teamId, playerId },
        { purpose: 'team-redemption', teamId: redemptionTeamId, playerId: redemptionPlayerId }
    ];
    for (const target of inviteTargets) {
        if (!invites.some((document) => matchesUsableInvite(
            document,
            lifecycleEmail,
            target.purpose,
            target.teamId,
            target.playerId
        ))) {
            const { purpose } = target;
            if (mode !== 'repair') throw new Error(`no usable ${purpose} lifecycle parent invite is provisioned`);
            await createInvite(session, lifecycleEmail, purpose, target.teamId, target.playerId);
        }
    }
    console.log(`Parent coverage purpose-bound lifecycle parent invites ${mode} passed.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(`Parent coverage invite maintenance failed: ${error?.message || 'Unknown error'}`);
        process.exitCode = 1;
    });
}
