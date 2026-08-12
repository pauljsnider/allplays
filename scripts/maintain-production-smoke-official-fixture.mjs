import { pathToFileURL } from 'node:url';
import {
    createFirebaseRestSession,
    getFirestoreDocument,
    patchFirestoreDocumentFields
} from '../tests/smoke/helpers/firebase-rest.js';

export const officialFixtureDate = '2099-01-01T18:00:00.000Z';
export const officialFixtureSlotId = 'allplays-smoke-official-v1';

function getStringField(fields, fieldName) {
    return String(fields?.[fieldName]?.stringValue || '');
}

function getArrayValues(field) {
    return Array.isArray(field?.arrayValue?.values) ? field.arrayValue.values : [];
}

function getSlotFields(value) {
    return value?.mapValue?.fields || {};
}

function isUnassignedOpenSlot(value) {
    const fields = getSlotFields(value);
    return getStringField(fields, 'status') === 'open' &&
        Boolean(getStringField(fields, 'position').trim()) &&
        !getStringField(fields, 'officialUserId') &&
        !getStringField(fields, 'officialEmail') &&
        !getStringField(fields, 'officialName');
}

function getGameDate(fields) {
    const value = fields?.date || {};
    return String(value.timestampValue || value.stringValue || '');
}

function getGameStatus(fields, fieldName) {
    return getStringField(fields, fieldName).trim().toLowerCase();
}

function isClosedGameStatus(status) {
    return [
        'cancelled',
        'canceled',
        'completed',
        'complete',
        'final',
        'finished',
        'ended'
    ].includes(status);
}

export function assertSmokeFixtureIdentifier(value, label) {
    if (!/^allplays-smoke-[A-Za-z0-9_-]+$/.test(String(value || ''))) {
        throw new Error(`${label} must identify a dedicated AllPlays smoke fixture`);
    }
}

export function inspectOfficialFixture(document, now = new Date()) {
    const fields = document?.fields || {};
    const dateValue = getGameDate(fields);
    const date = dateValue ? new Date(dateValue) : null;
    const status = getGameStatus(fields, 'status');
    const liveStatus = getGameStatus(fields, 'liveStatus');
    const slots = getArrayValues(fields.officiatingSlots);
    const openSlotCount = slots.filter(isUnassignedOpenSlot).length;
    const isUpcoming = Boolean(date && Number.isFinite(date.getTime()) && date.getTime() > now.getTime());
    const isCancelled = status === 'cancelled' || status === 'canceled';
    const isClosed = isClosedGameStatus(status) || isClosedGameStatus(liveStatus);

    return {
        ready: fields.officiatingSelfAssignmentEnabled?.booleanValue === true &&
            isUpcoming &&
            !isClosed &&
            openSlotCount > 0,
        isUpcoming,
        isCancelled,
        isClosed,
        status,
        liveStatus,
        openSlotCount,
        selfAssignmentEnabled: fields.officiatingSelfAssignmentEnabled?.booleanValue === true
    };
}

function buildFixtureSlot() {
    return {
        mapValue: {
            fields: {
                id: { stringValue: officialFixtureSlotId },
                position: { stringValue: 'Smoke official' },
                status: { stringValue: 'open' },
                scheduleReviewRequired: { booleanValue: false }
            }
        }
    };
}

export function buildOfficialFixturePatch(document, now = new Date()) {
    const fields = document?.fields || {};
    const slots = getArrayValues(fields.officiatingSlots);
    const inspection = inspectOfficialFixture(document, now);
    const nextSlots = inspection.openSlotCount > 0
        ? slots
        : [
            ...slots.filter(
                (value) => getStringField(getSlotFields(value), 'id') !== officialFixtureSlotId
            ),
            buildFixtureSlot()
        ];
    const patch = {
        officiatingSelfAssignmentEnabled: { booleanValue: true },
        officiatingSlots: { arrayValue: { values: nextSlots } }
    };

    if (!inspection.isUpcoming) {
        patch.date = { timestampValue: officialFixtureDate };
    }
    if (isClosedGameStatus(inspection.status)) {
        patch.status = { stringValue: 'scheduled' };
    }
    if (isClosedGameStatus(inspection.liveStatus)) {
        patch.liveStatus = { stringValue: 'scheduled' };
    }

    return { fields: patch };
}

function isAuthorizedFixtureManager(teamDocument, session, staffEmail) {
    const fields = teamDocument?.fields || {};
    if (getStringField(fields, 'ownerId') === session.localId) return true;
    const normalizedEmail = String(staffEmail || '').trim().toLowerCase();
    return getArrayValues(fields.adminEmails)
        .map((value) => String(value?.stringValue || '').trim().toLowerCase())
        .includes(normalizedEmail);
}

async function main() {
    const mode = String(process.env.SMOKE_FIXTURE_MODE || 'audit').trim().toLowerCase();
    if (!['audit', 'repair'].includes(mode)) {
        throw new Error('SMOKE_FIXTURE_MODE must be audit or repair');
    }

    const appBaseUrl = String(process.env.SMOKE_APP_BASE_URL || '').trim();
    const teamId = String(process.env.SMOKE_TEAM_ID || '').trim();
    const gameId = String(process.env.SMOKE_GAME_ID || '').trim();
    const staffEmail = String(process.env.SMOKE_STAFF_EMAIL || '').trim();
    const staffPassword = String(process.env.SMOKE_STAFF_PASSWORD || '');
    if (!appBaseUrl || !teamId || !gameId || !staffEmail || !staffPassword) {
        throw new Error('Protected production smoke fixture configuration is incomplete');
    }
    assertSmokeFixtureIdentifier(teamId, 'Team ID');
    assertSmokeFixtureIdentifier(gameId, 'Game ID');

    const session = await createFirebaseRestSession({
        appBaseUrl,
        email: staffEmail,
        password: staffPassword
    });
    const teamDocument = await getFirestoreDocument(session, `teams/${teamId}`);
    if (!teamDocument || !isAuthorizedFixtureManager(teamDocument, session, staffEmail)) {
        throw new Error('The staff smoke account is not an owner or administrator of the fixture team');
    }

    const gamePath = `teams/${teamId}/games/${gameId}`;
    const gameDocument = await getFirestoreDocument(session, gamePath);
    if (!gameDocument) {
        throw new Error('The officials smoke game fixture does not exist');
    }
    let inspection = inspectOfficialFixture(gameDocument);

    if (mode === 'repair' && !inspection.ready) {
        const patch = buildOfficialFixturePatch(gameDocument);
        await patchFirestoreDocumentFields(session, gamePath, patch.fields, {
            updateTime: String(gameDocument.updateTime || '')
        });
        const repairedDocument = await getFirestoreDocument(session, gamePath);
        inspection = inspectOfficialFixture(repairedDocument);
    }

    if (!inspection.ready) {
        throw new Error(
            `Officials fixture is not ready (upcoming=${inspection.isUpcoming}, ` +
            `self-assignment=${inspection.selfAssignmentEnabled}, open-slots=${inspection.openSlotCount}, ` +
            `status=${inspection.status || 'unset'}, live-status=${inspection.liveStatus || 'unset'})`
        );
    }

    console.log(`Officials fixture ${mode} passed with ${inspection.openSlotCount} open slot(s).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(`Production smoke officials fixture failed: ${error?.message || 'Unknown error'}`);
        process.exitCode = 1;
    });
}
