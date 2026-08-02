import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
    createFirebaseRestSession,
    createFirestoreDocument,
    findFirestoreDocumentsByStringField
} from '../tests/smoke/helpers/firebase-rest.js';

const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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

function timestampMillis(fields, name) {
    return Date.parse(String(fields?.[name]?.timestampValue || '')) || 0;
}

export function matchesUsableInvite(document, recipient, purpose, now = Date.now()) {
    const fields = document?.fields || {};
    return stringValue(fields, 'type') === 'parent_invite' &&
        stringValue(fields, 'email').toLowerCase() === recipient.toLowerCase() &&
        stringValue(fields, 'relation') === `Parent census ${purpose}` &&
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
    const lifecycleEmail = String(process.env.PARENT_CENSUS_LIFECYCLE_EMAIL || '');
    const teamId = String(process.env.PARENT_CENSUS_TEAM_ID || '');
    const playerId = String(process.env.PARENT_CENSUS_PLAYER_ID || '');
    if (!appBaseUrl || !adminEmail || !adminPassword || !lifecycleEmail || !teamId || !playerId) {
        throw new Error('protected parent census invite configuration is incomplete');
    }
    const session = await createFirebaseRestSession({ appBaseUrl, email: adminEmail, password: adminPassword });
    const invites = await findFirestoreDocumentsByStringField(session, 'accessCodes', 'generatedBy', session.localId);
    for (const purpose of ['signup', 'team-redemption']) {
        if (!invites.some((document) => matchesUsableInvite(document, lifecycleEmail, purpose))) {
            if (mode !== 'repair') throw new Error(`no usable ${purpose} lifecycle parent invite is provisioned`);
            await createInvite(session, lifecycleEmail, purpose, teamId, playerId);
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
