import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
    createFirebaseRestSession,
    createFirestoreDocument,
    findFirestoreDocumentsByStringField,
    getFirestoreDocument
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

export function matchesUsableInvite(document, recipient, now = Date.now()) {
    const fields = document?.fields || {};
    return stringValue(fields, 'type') === 'friend_invite' &&
        stringValue(fields, 'email').toLowerCase() === recipient.toLowerCase() &&
        !boolValue(fields, 'used') &&
        timestampMillis(fields, 'expiresAt') > now + 60 * 60 * 1000;
}

function profileMap(userDocument) {
    const fields = userDocument?.fields || {};
    const mapFields = {
        discoveryTeamIds: fields.parentTeamIds || { arrayValue: { values: [] } }
    };
    for (const name of ['displayName', 'fullName', 'photoUrl']) {
        if (fields[name]?.stringValue) mapFields[name] = { stringValue: fields[name].stringValue };
    }
    return { mapValue: { fields: mapFields } };
}

async function createInvite(session, recipient, userDocument) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = randomInviteCode();
        const now = new Date();
        try {
            await createFirestoreDocument(session, `accessCodes/${code}`, {
                code: { stringValue: code },
                type: { stringValue: 'friend_invite' },
                generatedBy: { stringValue: session.localId },
                email: { stringValue: recipient },
                phone: { nullValue: 'NULL_VALUE' },
                inviterProfile: profileMap(userDocument),
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
    const primaryEmail = String(process.env.PARENT_CENSUS_PRIMARY_EMAIL || '');
    const primaryPassword = String(process.env.PARENT_CENSUS_PRIMARY_PASSWORD || '');
    const lifecycleEmail = String(process.env.PARENT_CENSUS_LIFECYCLE_EMAIL || '');
    if (!appBaseUrl || !primaryEmail || !primaryPassword || !lifecycleEmail) {
        throw new Error('protected parent census invite configuration is incomplete');
    }
    const session = await createFirebaseRestSession({ appBaseUrl, email: primaryEmail, password: primaryPassword });
    const [userDocument, invites] = await Promise.all([
        getFirestoreDocument(session, `users/${session.localId}`),
        findFirestoreDocumentsByStringField(session, 'accessCodes', 'generatedBy', session.localId)
    ]);
    if (!userDocument) throw new Error('primary parent census profile is unavailable');
    if (!invites.some((document) => matchesUsableInvite(document, lifecycleEmail))) {
        if (mode !== 'repair') throw new Error('no usable lifecycle invite is provisioned');
        await createInvite(session, lifecycleEmail, userDocument);
    }
    console.log(`Parent coverage lifecycle invite ${mode} passed.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(`Parent coverage invite maintenance failed: ${error?.message || 'Unknown error'}`);
        process.exitCode = 1;
    });
}
